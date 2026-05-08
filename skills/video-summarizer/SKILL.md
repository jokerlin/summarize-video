---
name: video-summarizer
description: "Download videos from 1800+ platforms (YouTube, Bilibili, Twitter/X, TikTok, Vimeo, Instagram, etc.) and generate complete resource package with video, audio, subtitles, and AI summary. Actions: summarize, download, transcribe, extract video content. Platforms: youtube.com, bilibili.com, twitter.com, x.com, tiktok.com, vimeo.com, instagram.com, twitch.tv. Outputs: MP4 video, MP3 audio, VTT subtitles with timestamps, TXT transcript, MD AI summary. Auto-installs ffmpeg, yt-dlp. Implementation: TypeScript + Bun (no Python)."
---

# Video Summarizer

## Overview

Download videos from any platform supported by yt-dlp (1800+) and produce:

- `video.mp4` — original video (≤ 1080p)
- `audio.mp3` — extracted audio
- `subtitle.vtt` — subtitles with timestamps
- `transcript.txt` — plain-text transcript (no timestamps)
- `summary.md` — structured Markdown summary (you generate this in Step 6)

## Trigger Conditions

When the user:
- Provides a video link and asks for a summary
- Says "summarize this video", "what's in this video"
- Asks to "extract video content", "transcribe video"
- Says "download this video"
- Provides a link from YouTube/Bilibili/Twitter/Vimeo/TikTok etc.

## Output Structure

All files are saved to `./downloads/<video-title>/` in the current working directory (or to `<output>/<video-title>/` if `--output` is passed).

```
./downloads/
└── <video-title>/
    ├── video.mp4
    ├── audio.mp3
    ├── subtitle.vtt
    ├── transcript.txt
    ├── _metadata.json    # CLI writes this; you read it in Step 6
    └── summary.md         # YOU write this in Step 6
```

## Workflow

### Step 1: Install Dependencies (one time)

```bash
bun run "$SKILL_DIR/scripts/install_deps.ts"
```

This installs/checks: ffmpeg, ffprobe, yt-dlp, Xcode CLI Tools (macOS), and runs `bun install` for the smart-whisper N-API addon.

### Step 2-5: Run the CLI

```bash
bun run summarize "<URL>"
```

Optional flags:

| Flag | Default | Notes |
|---|---|---|
| `--model` | small | tiny / base / small / medium / large-v3 |
| `--language` | auto | Language code or 'auto' |
| `--workers` | floor(CPU/2) | Capped at floor(CPU/4) for memory safety |
| `--min-segment` | 60 | Min audio length (sec) before splitting |
| `--output` | ./downloads | Root output dir |
| `--cookies-from-browser` | — | chrome / firefox / edge / safari |
| `--skip-video` | false | Skip mp4 download |
| `--no-disk-check` | false | Skip free-space warning |

The CLI:
1. Fetches metadata (`yt-dlp --print`) and sanitizes the title for filesystem use.
2. Downloads `video.mp4` (mp4, ≤ 1080p, merged with audio).
3. Extracts `audio.mp3` (`yt-dlp -x --audio-format mp3`).
4. Tries 3 subtitle tiers, falling through:
   - **manual** — `yt-dlp --write-subs --sub-lang zh,en,zh-Hans,zh-Hant`
   - **auto** — `yt-dlp --write-auto-subs --sub-lang zh,en`
   - **whisper** — local parallel transcription via smart-whisper (whisper.cpp)
5. Writes `subtitle.vtt`, `transcript.txt`, and `_metadata.json`.

### Step 6: Generate `summary.md`

The CLI does NOT generate `summary.md`. **You** do this:

1. Read `<output_dir>/_metadata.json` for `{title, platform, url, duration, language, downloadTime}`.
2. Read `<output_dir>/transcript.txt` for `{transcript}`.
3. Read `$SKILL_DIR/reference/summary-prompt.md` for the template (with `{{TITLE}}`, `{{PLATFORM}}`, `{{URL}}`, `{{DURATION}}`, `{{LANGUAGE}}`, `{{DOWNLOAD_TIME}}`, `{{TRANSCRIPT}}` placeholders).
4. Substitute each placeholder, generate the actual structured summary, and write it to `<output_dir>/summary.md`.

## Platform-Specific Handling

### Bilibili
```bash
bun run summarize "<URL>" --cookies-from-browser chrome
```

### Authenticated content
```bash
bun run summarize "<URL>" --cookies-from-browser chrome   # or firefox
```

## Error Handling

- **No subtitles available** — Whisper auto-runs (Tier 3).
- **Long video (> 1 hour)** — Parallel script handles it; warn the user about Whisper time and disk usage.
- **Unsupported platform** — `yt-dlp --list-extractors | grep -i "<name>"`.
- **Missing dependencies** — Run install_deps.ts.

## Notes

1. Files saved to `./downloads/` in the current working directory.
2. For personal learning use only.
3. First Whisper run downloads the model to `~/.cache/whisper-models/` (~244 MB for `small`).
4. macOS: smart-whisper uses CoreML/Metal acceleration when built with the default options — significantly faster than CPU-only Python on Apple Silicon.
