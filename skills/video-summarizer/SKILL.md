---
name: video-summarizer
description: "Download videos from 1800+ platforms (YouTube, Bilibili, Twitter/X, TikTok, Vimeo, Instagram, etc.) and generate complete resource package with audio, subtitles, transcript, and AI summary. Actions: summarize, download, transcribe, extract video content. Platforms: youtube.com, bilibili.com, twitter.com, x.com, tiktok.com, vimeo.com, instagram.com, twitch.tv. Outputs: MP3 audio, VTT subtitles with timestamps, TXT transcript, MD AI summary (MP4 video optional). Auto-installs ffmpeg, yt-dlp, whisper-cpp. Implementation: TypeScript + Bun, transcription via whisper.cpp's whisper-cli (Metal-accelerated on Apple Silicon)."
---

# Video Summarizer

## Overview

Download videos from any platform supported by yt-dlp (1800+) and produce:

- `subtitle.vtt` — subtitles with timestamps (always)
- `transcript.txt` — plain-text transcript (always)
- `summary.md` — structured Markdown summary (you generate this in Step 6)
- `audio.mp3` — only when whisper had to run, or when `--with-audio` is passed
- `video.mp4` — only when `--with-video` is passed

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
    ├── subtitle.vtt
    ├── transcript.txt
    ├── _metadata.json    # CLI writes this; you read it in Step 6
    ├── summary.md         # YOU write this in Step 6
    ├── audio.mp3          # only if whisper ran, or --with-audio was passed
    └── video.mp4          # only if --with-video was passed
```

## Workflow

### Step 1: Install Dependencies (one time)

```bash
bun run "$SKILL_DIR/scripts/install_deps.ts"
```

This installs/checks: ffmpeg, ffprobe, yt-dlp, and `whisper-cli` (whisper.cpp via `brew install whisper-cpp`).

### Step 2-5: Run the CLI

```bash
bun run summarize "<URL>"
```

By default the CLI:
- Sends Chrome cookies to yt-dlp (handles YouTube's bot challenge and authenticated content). Pass `--no-cookies` to disable, or `--cookies-from-browser firefox` to switch browsers.
- Only fetches what's strictly needed for the transcript. If subtitles are available (Tier 1/2), nothing else is downloaded. If whisper has to run (Tier 3), audio is downloaded for it. Pass `--with-audio` / `--with-video` to keep those files in any case.

Optional flags:

| Flag | Default | Notes |
|---|---|---|
| `--model` | base | tiny / base / small / medium / large-v3 |
| `--language` | auto | Language code or 'auto' |
| `--output` | ./downloads | Root output dir |
| `--cookies-from-browser` | chrome | chrome / firefox / edge / safari |
| `--no-cookies` | false | Disable cookie extraction (mutually exclusive with `--cookies-from-browser`) |
| `--with-video` | false | Also download video.mp4 |
| `--with-audio` | false | Always keep audio.mp3 (default: only when whisper runs) |
| `--no-disk-check` | false | Skip free-space warning |

The CLI:
1. Fetches metadata (`yt-dlp --print`) and sanitizes the title for filesystem use.
2. (Optional) Downloads `video.mp4` (mp4, ≤ 1080p, merged with audio) when `--with-video` is set.
3. Tries 3 subtitle tiers, falling through:
   - **manual** — `yt-dlp --write-subs --sub-lang zh,en,zh-Hans,zh-Hant`
   - **auto** — `yt-dlp --write-auto-subs --sub-lang zh,en`
   - **whisper** — downloads `audio.mp3` (`yt-dlp -x --audio-format mp3`), then runs `whisper-cli` (whisper.cpp, Metal GPU on Apple Silicon).
4. If `--with-audio` is set and Tier 1/2 hit, downloads `audio.mp3` afterwards.
5. Writes `subtitle.vtt`, `transcript.txt`, and `_metadata.json`.

### Step 6: Generate `summary.md`

The CLI does NOT generate `summary.md`. **You** do this:

1. Read `<output_dir>/_metadata.json` for `{title, platform, url, duration, language, downloadTime}`.
2. Read `<output_dir>/transcript.txt` for `{transcript}`.
3. Read `$SKILL_DIR/reference/summary-prompt.md` for the template (with `{{TITLE}}`, `{{PLATFORM}}`, `{{URL}}`, `{{DURATION}}`, `{{LANGUAGE}}`, `{{DOWNLOAD_TIME}}`, `{{TRANSCRIPT}}` placeholders).
4. Substitute each placeholder, generate the actual structured summary, and write it to `<output_dir>/summary.md`.

## Platform-Specific Handling

Default cookies (Chrome) are usually enough. To switch browsers or disable:
```bash
bun run summarize "<URL>" --cookies-from-browser firefox
bun run summarize "<URL>" --no-cookies
```

## Error Handling

- **No subtitles available** — `whisper-cli` auto-runs (Tier 3).
- **Long video (> 1 hour)** — Whisper handles it; on Apple Silicon, Metal makes this 5–10× faster than the Python whisper CLI.
- **Unsupported platform** — `yt-dlp --list-extractors | grep -i "<name>"`.
- **Missing dependencies** — Run install_deps.ts. Specifically: `brew install whisper-cpp`.

## Notes

1. Files saved to `./downloads/` in the current working directory.
2. For personal learning use only.
3. First whisper run downloads the model to `~/.cache/whisper-cpp/` (~74 MB for `base`, ~244 MB for `small`).
4. `whisper-cli` uses Metal GPU acceleration on Apple Silicon by default — significantly faster than CPU-bound Python whisper.
