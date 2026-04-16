# Synthetiq Voice

![Synthetiq Voice logo](assets/synthetiq-logo.svg)

Synthetiq Voice is a privacy-first Windows dictation app that runs speech-to-text locally on your device. It lives in the system tray, opens as a compact flyout above the tray, records from your microphone, transcribes locally, and gives you editable text that can be copied or pasted into any app.

It is built for quick messages, coding with AI assistants, notes, support replies, and any workflow where speaking is faster than typing.

## Highlights

- Local speech-to-text with `faster-whisper`
- No cloud transcription after the selected model is downloaded
- Compact Electron tray flyout for Windows
- Record, Stop, Clear, Edit, Copy, Paste, and Add To controls
- Read-only transcript until Edit is enabled
- Recent transcription history stored locally in the app
- Active microphone scan and live mic level meter
- Model picker with download, preload, and delete controls
- Recommended fast setup with `small.en` on CPU INT8
- Developer CUDA mode for larger models
- Smart CPU routing for tiny models when CUDA would be slower
- CPU fallback when CUDA transcription fails
- Optional start with Windows
- Temporary WAV files deleted after transcription by default

## Why Local

Synthetiq Voice is designed around local-first dictation. Microphone audio is captured on device, processed by the local Python worker, and deleted after transcription unless debug audio retention is explicitly enabled in development.

The expected network use is first-time model download through the model provider used by `faster-whisper`. After a model is cached, transcription runs locally.

## Recommended Model

The default model is:

```text
small.en on CPU INT8
```

That is the best default for this app because it stays close to the sub-1 GB target, responds quickly on normal Windows hardware, and gives good English dictation quality.

Developer CUDA mode can be faster for larger models, but it is not automatically better for every case. For short clips with `base.en` or `small.en`, GPU startup overhead is usually slower than CPU. Synthetiq Voice therefore routes `base.en` and `small.en` to CPU INT8 even when CUDA is enabled.

## Model Presets

| Model | Approx size | Speed | Quality | Best use |
| --- | ---: | --- | --- | --- |
| `base.en` | ~150 MB | Fastest | Basic | Older PCs, very short dictation |
| `small.en` | ~500 MB | Fast | Good | Recommended default |
| `medium.en` | ~1.5 GB | Medium | Better | Higher accuracy, longer dictation |
| `distil-large-v3` | ~1.5 GB | Medium | Very good | Strong quality with better speed than full large models |
| `large-v3-turbo` | ~1.6 GB | GPU fast / CPU slower | Best | Best quality when CUDA is stable |

Downloaded models can be removed from Settings. Deleting a model removes only the known local Hugging Face cache folders for that model, and the model can be downloaded again later.

## CUDA Support

CUDA is available under Settings > Developer Options.

CUDA support is intentionally opt-in because it depends on the user's NVIDIA driver, CUDA/cuDNN runtime, and the `faster-whisper` / CTranslate2 stack. The app detects NVIDIA GPUs with `nvidia-smi`, shows the detected device in Developer Options, and allows CUDA mode only after Developer Options are enabled.

Behavior:

- `base.en` and `small.en` use CPU INT8 for low-latency dictation.
- `medium.en`, `distil-large-v3`, and `large-v3-turbo` can use CUDA when enabled.
- The selected route is preloaded when possible.
- If CUDA transcription fails, the worker retries once on CPU.

## Install

Requirements:

- Windows 10 or Windows 11
- Python 3.12+
- Node.js 24+
- Optional: NVIDIA GPU and compatible CUDA runtime for Developer CUDA mode

From the project folder:

```powershell
.\scripts\install.ps1
```

Start the app:

```powershell
.\Start-SynthetiqVoice.cmd
```

The first model download can take a few minutes. Start with `small.en` for the best first-run experience.

## Usage

1. Open Synthetiq Voice from the tray icon.
2. Use Scan if the mic meter is not moving.
3. Choose a microphone and model.
4. Click Record.
5. Speak.
6. Click Stop.
7. Review the transcript.
8. Use Edit, Copy, Paste, Clear, or Add To.
9. Open My Transcriptions to review recent local history.
10. Open Settings to manage models, startup behavior, or Developer Options.

## Project Structure

```text
app/                 Electron tray UI
assets/              Logo and tray icon assets
scripts/             Install and validation scripts
worker/              Python FastAPI speech-to-text worker
Start-SynthetiqVoice.cmd
Launch-SynthetiqVoice.vbs
```

## Development

Install dependencies:

```powershell
.\scripts\install.ps1
```

Run validation:

```powershell
npm run check
.\.venv\Scripts\python.exe -m py_compile .\worker\stt_worker.py
```

Run the app in development:

```powershell
npm start
```

The worker listens locally on `127.0.0.1:48731`. Runtime files, settings, and logs are written to `runtime/`, which is intentionally ignored by git.

## Privacy

- Audio is recorded locally through the selected Windows input device.
- Transcription runs locally through `faster-whisper`.
- Temporary WAV files are deleted after transcription unless debug retention is enabled.
- Recent transcription history is stored locally in browser storage.
- Model files are cached locally by Hugging Face / faster-whisper.

## Roadmap

- Packaged Windows installer
- Signed releases
- Global hotkey recording
- Better history management
- Optional punctuation and formatting presets
- Import/export settings

## Credits

- Speech-to-text: `faster-whisper`
- Model family: OpenAI Whisper-compatible models
- UI runtime: Electron
- Worker runtime: FastAPI

## License

MIT
