# Synthetiq Voice

Synthetiq Voice is a privacy-first Windows dictation app that runs speech-to-text locally on your device. It lives in the system tray, opens as a small tray flyout, records from your microphone, transcribes locally, and lets you edit, copy, or paste text without switching into a full-screen app.

It is designed for quick messages, coding with AI assistants, notes, support replies, and any workflow where typing slows you down.

## Features

- Local speech-to-text using `faster-whisper`
- No cloud transcription after the selected model is downloaded
- Tray icon with compact flyout UI
- Record, Stop, Clear, Edit, Copy, Paste controls
- Read-only transcript until you choose Edit
- Add To mode for continuing a transcript
- Active microphone finder and live mic level meter
- Model picker with explicit model download, preload, and delete controls
- Developer CUDA mode with smart CPU routing for tiny models
- Optional start with Windows
- Temporary audio is deleted after transcription by default

## Recommended Model

The default model is `small.en` on CPU INT8.

That is the best current default for this app because it stays around the sub-1 GB target, responds quickly on normal Windows hardware, and gives good English dictation quality. Developer CUDA mode can be faster for `medium.en`, `distil-large-v3`, and `large-v3-turbo`, but it needs the correct NVIDIA CUDA/cuDNN runtime. `base.en` and `small.en` are routed to CPU INT8 even when CUDA is enabled because GPU startup overhead is usually slower for short dictation clips.

Available model presets:

| Model | Approx size | Speed | Quality | Notes |
| --- | ---: | --- | --- | --- |
| `base.en` | ~150 MB | Fastest | Basic | Good fallback for older PCs |
| `small.en` | ~500 MB | Fast | Good | Recommended default under 1 GB |
| `medium.en` | ~1.5 GB | Medium | Better | Higher accuracy, above 1 GB |
| `distil-large-v3` | ~1.5 GB | Medium | Very good | Strong model, above 1 GB |
| `large-v3-turbo` | ~1.6 GB | GPU fast / CPU slow | Best | Best quality, not ideal for instant CPU dictation |

## Install

Requirements:

- Windows 10/11
- Python 3.12+
- Node.js 24+

From the project folder:

```powershell
.\scripts\install.ps1
```

Start the app:

```powershell
.\Start-SynthetiqVoice.cmd
```

The first model download can take a few minutes. After that, the model is cached locally. For the best first-run experience, start with `small.en`. Larger models are optional and can take much longer to download.

Downloaded models can be removed from Settings. Deleting a model removes only the known local Hugging Face cache folders for that model; it can be downloaded again later.

## Usage

1. Open Synthetiq Voice from the tray icon.
2. Use Find Active Mic if the mic meter is not moving.
3. Click Record.
4. Speak.
5. Click Stop.
6. Review the transcript.
7. Use Edit, Copy, Paste, Clear, or Add To.
8. Use Settings > Developer Options to enable experimental CUDA support. If CUDA fails during transcription, the worker retries once on CPU.

## Privacy

Synthetiq Voice is local-first. Microphone audio is captured on device, transcribed locally, and temporary WAV files are deleted after transcription unless debug retention is enabled.

The only expected network use is first-time model download through the model provider used by `faster-whisper`.

## Development

```powershell
npm run check
npm start
```

Project structure:

- `app/` Electron tray UI
- `worker/` Python FastAPI speech-to-text worker
- `scripts/` install and validation scripts
- `assets/` local icon assets

## Credits

- Speech-to-text: `faster-whisper`
- Model family: OpenAI Whisper compatible models
- Tray icon source: Bootstrap Icons `mic-fill.svg`, MIT licensed

## License

MIT
