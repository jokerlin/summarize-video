<div align="center">

# 🎬 Video Summarizer

**Download any video, get a clean transcript, hand Claude a summary-ready package.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-≥1.1-fbf0df?logo=bun&logoColor=000)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-1800%2B%20sites-red)](https://github.com/yt-dlp/yt-dlp)
[![whisper.cpp](https://img.shields.io/badge/whisper.cpp-Metal-4b8bbe)](https://github.com/ggml-org/whisper.cpp)

**English** · [简体中文](./README.zh-CN.md)

</div>

---

A small CLI that pulls audio from 1800+ video platforms, transcribes it locally with whisper.cpp, and packages everything Claude needs to write a summary. Built as a Claude Code skill, but the CLI runs fine on its own.

## ✨ Features

- **🌐 Works almost anywhere** — anything `yt-dlp` supports: YouTube, Bilibili, Twitter / X, TikTok, Vimeo, Instagram, Twitch, …
- **🔇 Audio-first** — pulls only `audio.mp3` by default; pass `--with-video` when you actually need the mp4
- **📝 Three-tier subtitles** — official subs → auto-generated subs → local Whisper, in that order
- **⚡ Fast on Apple Silicon** — `whisper-cli` runs on Metal, roughly 5–10× faster than the Python whisper CLI on the same model
- **🍪 Cookie-aware** — Chrome cookies by default, so YouTube's bot challenge stays out of your way
- **📦 Zero glue code** — Bun + TypeScript only; no build step, no Python venv

## 📦 Installation

### Option A — Claude Code plugin (recommended)

Inside Claude Code:

```
/plugin marketplace add jokerlin/summarize-video
/plugin install video-summarizer@video-summarizer
```

When invoked as a Claude Code skill, the install script auto-runs the first time (`ffmpeg`, `ffprobe`, `yt-dlp`, `whisper-cpp` via Homebrew on macOS).

To update later:

```
/plugin marketplace update video-summarizer
/reload-plugins
```

To uninstall: `/plugin uninstall video-summarizer@video-summarizer`. Marketplaces with auto-update enabled (the default for marketplaces you add yourself) will pull new versions automatically at Claude Code startup.

### Option B — Standalone CLI

```bash
git clone https://github.com/jokerlin/summarize-video
cd summarize-video
bun install
bun run skills/video-summarizer/scripts/install_deps.ts
```

The install script checks for and installs `ffmpeg`, `ffprobe`, `yt-dlp`, and `whisper-cpp` (via Homebrew on macOS).

## 🚀 Usage

```bash
bun run summarize "https://www.youtube.com/watch?v=..."
```

### Common flags

```bash
# also keep the mp4 (default is audio-only)
bun run summarize "<URL>" --with-video

# pick a different Whisper model (default: base)
bun run summarize "<URL>" --model small

# use Firefox cookies instead of Chrome
bun run summarize "<URL>" --cookies-from-browser firefox

# disable cookies entirely
bun run summarize "<URL>" --no-cookies
```

Run `bun run summarize --help` for the full flag list.

### Output

```
./downloads/
└── <Video_Title>/
    ├── audio.mp3         # extracted audio
    ├── subtitle.vtt      # subtitles with timestamps
    ├── transcript.txt    # plain-text transcript
    ├── _metadata.json    # title / platform / url / duration / source
    ├── summary.md        # Claude generates this in skill mode
    └── video.mp4         # only if --with-video was passed
```

## 🎯 How It Works

1. **Metadata** — `yt-dlp --print` for title, duration, platform, language
2. **Audio** — `yt-dlp -x --audio-format mp3` extracts `audio.mp3`
3. **Video** *(optional)* — with `--with-video`, downloads `bestvideo[≤1080p]+bestaudio` merged to `video.mp4`
4. **Subtitles** — three-tier fallback:
   1. `yt-dlp --write-subs` — official subs (zh / en / zh-Hans / zh-Hant)
   2. `yt-dlp --write-auto-subs` — auto-generated (zh / en)
   3. `whisper-cli` — local transcription
5. **Transcript** — `subtitle.vtt` parsed into a clean, timestamp-free `transcript.txt`
6. **Summary** — written by Claude when invoked as a Claude Code skill; the CLI alone covers steps 1–5

## 🤖 Whisper Models

| Model        | Size    | Speed   | Quality     |
| ------------ | ------- | ------- | ----------- |
| tiny         | 39 MB   | Fastest | Basic       |
| **base**     | 74 MB   | Fast    | **Default** |
| small        | 244 MB  | Medium  | Good        |
| medium       | 769 MB  | Slow    | Better      |
| large-v3     | 1.5 GB  | Slowest | Best        |

GGML models auto-download from HuggingFace (`ggerganov/whisper.cpp`) into `~/.cache/whisper-cpp/` on first use.

## 🛠 Tech Stack

| Concern       | Choice                                            |
| ------------- | ------------------------------------------------- |
| Runtime       | Bun ≥ 1.1 (TypeScript, no transpile step)         |
| Download      | yt-dlp                                            |
| Demux / probe | ffmpeg / ffprobe                                  |
| ASR           | `whisper-cli` (whisper.cpp + Metal / CUDA)        |
| Lint / format | Biome                                             |

ASR history: this project briefly used `smart-whisper` (whisper.cpp via N-API) for in-process parallel inference, then `openai-whisper` (Python CLI) for stability. Both were replaced by `whisper-cli` directly — it accepts mp3 natively, runs on Metal out of the box, and is roughly 5–10× faster than the Python whisper CLI on the same model.

## 🧪 Development

```bash
bun test           # unit tests
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun run format     # biome format --write
```

See [`test/MANUAL.md`](./test/MANUAL.md) for the end-to-end smoke test procedure (YouTube / Bilibili / Twitter).

## 📄 License

[MIT](./LICENSE) © [jokerlin](https://github.com/jokerlin)

> Not affiliated with Anthropic.

## 🙏 Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — the universal video downloader
- [ffmpeg](https://ffmpeg.org/) — audio extraction and probing
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — fast local transcription
