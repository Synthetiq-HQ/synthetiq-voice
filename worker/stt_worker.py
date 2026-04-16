from __future__ import annotations

import os
import queue
import tempfile
import threading
import time
import wave
import traceback
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import numpy as np
import sounddevice as sd
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from faster_whisper import WhisperModel
except Exception:  # pragma: no cover - reported by /health
    WhisperModel = None


ROOT = Path(os.environ.get("LOCAL_DICTATION_ROOT", Path(__file__).resolve().parents[1]))
RUNTIME = ROOT / "runtime"
RUNTIME.mkdir(parents=True, exist_ok=True)


class Settings(BaseModel):
    selectedDeviceId: Optional[int | str] = None
    modelSize: str = "small.en"
    computeDevice: str = "cpu"
    computeType: str = "int8"
    language: str = "en"
    debugKeepAudio: bool = False


class ModelDownloadRequest(BaseModel):
    modelSize: str
    computeDevice: str = "cpu"
    computeType: str = "int8"


class StartRequest(BaseModel):
    deviceId: Optional[int] = None


@dataclass
class RecorderState:
    active: bool = False
    samplerate: int = 16000
    channels: int = 1
    device_id: Optional[int] = None
    started_at: float = 0.0


app = FastAPI(title="Local Dictation Worker")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
settings = Settings()
recorder_state = RecorderState()
audio_queue: "queue.Queue[np.ndarray]" = queue.Queue()
recorded_chunks: list[np.ndarray] = []
record_lock = threading.Lock()
stream: Optional[sd.InputStream] = None
model = None
model_key: Optional[tuple[str, str, str]] = None
worker_status = "ready"
last_level = {"rms": 0.0, "peak": 0.0, "updated_at": 0.0}
last_result = {}
worker_log_path = RUNTIME / "worker.log"


def log(message: str):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n"
    worker_log_path.parent.mkdir(parents=True, exist_ok=True)
    with worker_log_path.open("a", encoding="utf-8") as handle:
        handle.write(line)
    print(message, flush=True)


MODEL_CATALOG = [
    {
        "id": "base.en",
        "label": "Base English",
        "size": "~150 MB",
        "speed": "Fastest",
        "quality": "Basic",
        "recommended": False,
        "notes": "Good for older CPUs and short clean dictation.",
    },
    {
        "id": "small.en",
        "label": "Small English",
        "size": "~500 MB",
        "speed": "Fast",
        "quality": "Good",
        "recommended": True,
        "notes": "Default. Best balance for quick local dictation under 1 GB.",
    },
    {
        "id": "medium.en",
        "label": "Medium English",
        "size": "~1.5 GB",
        "speed": "Medium",
        "quality": "Better",
        "recommended": False,
        "notes": "Higher accuracy, but above the 1 GB target and slower.",
    },
    {
        "id": "distil-large-v3",
        "label": "Distil Large v3",
        "size": "~1.5 GB",
        "speed": "Medium",
        "quality": "Very good",
        "recommended": False,
        "notes": "Strong model, but usually larger than the 1 GB target.",
    },
    {
        "id": "large-v3-turbo",
        "label": "Large v3 Turbo",
        "size": "~1.6 GB",
        "speed": "GPU fast / CPU slow",
        "quality": "Best",
        "recommended": False,
        "notes": "Best quality option, but not ideal for instant CPU dictation.",
    },
]


def input_devices():
    raw_devices = sd.query_devices()
    defaults = sd.default.device
    default_input = defaults[0] if isinstance(defaults, (list, tuple)) and defaults[0] is not None and defaults[0] >= 0 else None
    devices_out = []
    for index, device in enumerate(raw_devices):
        if device.get("max_input_channels", 0) > 0:
            name = device.get("name", f"Input {index}")
            is_mapper = "Microsoft Sound Mapper" in name or "Primary Sound Capture Driver" in name
            is_microphone = "microphone" in name.lower()
            is_bkd = "bkd" in name.lower() or "pro audio" in name.lower()
            devices_out.append(
                {
                    "id": index,
                    "name": name,
                    "channels": int(device.get("max_input_channels", 0)),
                    "default_samplerate": int(device.get("default_samplerate", 44100)),
                    "default_input": index == default_input,
                    "recommended": False,
                    "score": (100 if index == default_input else 0)
                    + (50 if is_bkd else 0)
                    + (25 if is_microphone else 0)
                    - (80 if is_mapper else 0),
                }
            )
    if devices_out:
        recommended = sorted(devices_out, key=lambda d: d["score"], reverse=True)[0]
        recommended["recommended"] = True
    return default_input, devices_out


def choose_compute() -> tuple[str, str]:
    if settings.computeDevice == "cpu":
        return "cpu", "int8"
    if settings.computeDevice == "cuda":
        return "cuda", "float16"
    return "cpu", "int8"


def load_model():
    global model, model_key, worker_status
    if WhisperModel is None:
        raise HTTPException(status_code=500, detail="faster-whisper is not installed.")

    device, compute_type = choose_compute()
    desired_key = (settings.modelSize, device, compute_type)
    if model is not None and model_key == desired_key:
        return model

    try:
        worker_status = f"loading model {settings.modelSize} on {device}"
        log(worker_status)
        model = WhisperModel(settings.modelSize, device=device, compute_type=compute_type)
        model_key = desired_key
        worker_status = "ready"
        return model
    except Exception as cuda_error:
        if device != "cuda":
            worker_status = "ready"
            raise HTTPException(status_code=500, detail=str(cuda_error))
        try:
            worker_status = f"loading model {settings.modelSize} on cpu"
            log(worker_status)
            model = WhisperModel(settings.modelSize, device="cpu", compute_type="int8")
            model_key = (settings.modelSize, "cpu", "int8")
            worker_status = "ready"
            return model
        except Exception as cpu_error:
            worker_status = "ready"
            raise HTTPException(status_code=500, detail=f"CUDA failed: {cuda_error}; CPU failed: {cpu_error}")


def audio_callback(indata, frames, callback_time, status):
    if status:
        print(status, flush=True)
    arr = indata.astype(np.float32).reshape(-1)
    if arr.size:
        last_level["rms"] = float(np.sqrt(np.mean(np.square(arr))))
        last_level["peak"] = float(np.max(np.abs(arr)))
        last_level["updated_at"] = time.time()
    audio_queue.put(indata.copy())


def drain_queue():
    while True:
        try:
            recorded_chunks.append(audio_queue.get_nowait())
        except queue.Empty:
            break


def write_wav(samples: np.ndarray, samplerate: int) -> Path:
    fd, name = tempfile.mkstemp(prefix="dictation-", suffix=".wav", dir=RUNTIME)
    os.close(fd)
    path = Path(name)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(samplerate)
        wav.writeframes(pcm.tobytes())
    return path


def trim_silence(samples: np.ndarray, threshold: float = 0.0015, padding_seconds: float = 0.35, samplerate: int = 16000) -> np.ndarray:
    if samples.size == 0:
        return samples
    abs_samples = np.abs(samples)
    # Dynamic threshold keeps quiet USB microphones from being trimmed to nothing.
    noise_floor = float(np.percentile(abs_samples, 35))
    threshold = max(threshold, noise_floor * 2.5)
    voiced = np.where(abs_samples > threshold)[0]
    if voiced.size == 0:
        return samples
    pad = int(padding_seconds * samplerate)
    start = max(int(voiced[0]) - pad, 0)
    end = min(int(voiced[-1]) + pad, samples.size)
    return samples[start:end]


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "faster-whisper" if WhisperModel else "missing",
        "recording": recorder_state.active,
        "model": model_key or None,
        "status": worker_status,
    }


@app.get("/status")
def status():
    drain_queue()
    captured_seconds = 0.0
    if recorded_chunks:
        captured_seconds = sum(chunk.shape[0] for chunk in recorded_chunks) / max(recorder_state.samplerate, 1)
    return {
        "recording": recorder_state.active,
        "status": worker_status,
        "captured_seconds": captured_seconds,
        "level": last_level,
        "last_result": last_result,
        "model": model_key,
    }


@app.get("/devices")
def devices():
    try:
        default_input, devices_out = input_devices()
        recommended = next((d["id"] for d in devices_out if d.get("recommended")), default_input)
        return {"default_input": default_input, "recommended_input": recommended, "devices": devices_out}
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.get("/models")
def models():
    return {"models": MODEL_CATALOG, "active": model_key}


@app.post("/models/download")
def download_model(request: ModelDownloadRequest):
    global settings, worker_status
    previous = settings
    try:
        settings = Settings(
            selectedDeviceId=previous.selectedDeviceId,
            modelSize=request.modelSize,
            computeDevice=request.computeDevice,
            computeType=request.computeType,
            language=previous.language,
            debugKeepAudio=previous.debugKeepAudio,
        )
        worker_status = f"downloading/loading {request.modelSize}"
        started = time.time()
        load_model()
        elapsed = time.time() - started
        worker_status = "ready"
        return {"ok": True, "model": model_key, "seconds": elapsed}
    except Exception as error:
        worker_status = "ready"
        raise HTTPException(status_code=500, detail=str(error))


@app.get("/devices/levels")
def device_levels():
    try:
        _, devices_out = input_devices()
        rows = []
        for device in devices_out:
            try:
                samplerate = int(device.get("default_samplerate") or 44100)
                frames = max(int(samplerate * 0.35), 1)
                data = sd.rec(
                    frames,
                    samplerate=samplerate,
                    channels=1,
                    dtype="float32",
                    device=int(device["id"]),
                    blocking=True,
                )
                arr = np.asarray(data).reshape(-1)
                rms = float(np.sqrt(np.mean(np.square(arr)))) if arr.size else 0.0
                peak = float(np.max(np.abs(arr))) if arr.size else 0.0
                rows.append({**device, "rms": rms, "peak": peak, "error": ""})
            except Exception as error:
                rows.append({**device, "rms": 0.0, "peak": 0.0, "error": str(error)})
        rows.sort(key=lambda d: d["peak"], reverse=True)
        return {"devices": rows, "best": rows[0] if rows else None}
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.post("/settings")
def update_settings(new_settings: Settings):
    global settings
    settings = new_settings
    return settings.model_dump()


@app.post("/record/start")
def start_recording(request: StartRequest):
    global stream, recorded_chunks, worker_status, last_result
    with record_lock:
        if recorder_state.active:
            raise HTTPException(status_code=409, detail="Already recording.")
        recorded_chunks = []
        last_result = {}
        drain_queue()
        device_id = request.deviceId if request.deviceId is not None else settings.selectedDeviceId
        if device_id in ("", None):
            device_id = None
        else:
            device_id = int(device_id)

        try:
            if device_id is not None:
                device_info = sd.query_devices(device_id)
                samplerate = int(device_info.get("default_samplerate", 44100))
            else:
                samplerate = 44100
            recorder_state.samplerate = samplerate
            recorder_state.channels = 1
            stream = sd.InputStream(
                samplerate=recorder_state.samplerate,
                channels=recorder_state.channels,
                dtype="float32",
                device=device_id,
                callback=audio_callback,
            )
            stream.start()
        except Exception as error:
            stream = None
            raise HTTPException(status_code=500, detail=str(error))

        recorder_state.active = True
        recorder_state.device_id = device_id
        recorder_state.started_at = time.time()
        worker_status = "recording"
        return asdict(recorder_state)


@app.post("/record/stop")
def stop_recording():
    global stream, worker_status, last_result
    with record_lock:
        if not recorder_state.active:
            raise HTTPException(status_code=409, detail="Not recording.")
        try:
            if stream:
                stream.stop()
                stream.close()
        finally:
            stream = None
            recorder_state.active = False
            worker_status = "preparing audio"
        drain_queue()

    if not recorded_chunks:
        worker_status = "ready"
        last_result = {"text": "", "duration": 0, "reason": "No audio frames captured."}
        return {**last_result, "segments": []}

    samples = np.concatenate(recorded_chunks, axis=0).reshape(-1).astype(np.float32)
    duration = samples.size / recorder_state.samplerate
    rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    log(f"recorded duration={duration:.2f}s rms={rms:.6f} peak={peak:.6f} sr={recorder_state.samplerate}")
    if peak < 0.0008:
        worker_status = "ready"
        last_result = {
            "text": "",
            "duration": duration,
            "rms": rms,
            "peak": peak,
            "reason": "The app recorded almost silence. Try another BKD microphone entry, raise Windows input volume, or check mic permissions.",
        }
        return {**last_result, "segments": []}
    samples = trim_silence(samples, samplerate=recorder_state.samplerate)
    if samples.size < int(0.2 * recorder_state.samplerate):
        worker_status = "ready"
        last_result = {
            "text": "",
            "duration": duration,
            "rms": rms,
            "peak": peak,
            "reason": "No speech detected. If the level is near zero, choose a different microphone.",
        }
        return {**last_result, "segments": []}

    wav_path = write_wav(samples, recorder_state.samplerate)
    try:
        try:
            worker_status = "loading model"
            whisper_model = load_model()
            worker_status = "transcribing"
            log(f"transcribing {wav_path.name} with model={model_key}")
            segments, info = whisper_model.transcribe(
                str(wav_path),
                language=settings.language or None,
                vad_filter=False,
                beam_size=1,
                temperature=0.0,
                condition_on_previous_text=False,
            )
        except Exception as error:
            worker_status = "ready"
            log("transcription failed: " + repr(error))
            log(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(error))
        segment_rows = [
            {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
            for segment in segments
        ]
        text = " ".join(row["text"] for row in segment_rows).strip()
        worker_status = "ready"
        last_result = {
            "text": text,
            "duration": duration,
            "rms": rms,
            "peak": peak,
            "language": getattr(info, "language", None),
            "model": model_key,
            "reason": "" if text else "Audio was captured, but Whisper returned no text. Try speaking longer or louder.",
        }
        return {**last_result, "segments": segment_rows}
    finally:
        worker_status = "ready"
        if not settings.debugKeepAudio:
            try:
                wav_path.unlink(missing_ok=True)
            except Exception:
                pass


if __name__ == "__main__":
    port = int(os.environ.get("LOCAL_DICTATION_PORT", "48731"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
