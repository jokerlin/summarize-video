# Video Summarizer (TypeScript + Bun)

Downloads videos from any of the 1800+ platforms supported by yt-dlp, fetches or transcribes subtitles, and prepares a Claude-ready summary package.

> **Note:** This is a skill for Claude Code CLI. Not affiliated with Anthropic.

## How It Works

1. **Metadata** — `yt-dlp --print` for title, duration, platform, language.
2. **Video** — `yt-dlp` downloads `bestvideo[≤1080p]+bestaudio` merged to `video.mp4`.
3. **Audio** — `yt-dlp -x --audio-format mp3` extracts `audio.mp3`.
4. **Subtitles** — three-tier fallback:
   - Tier 1: `yt-dlp --write-subs` (manual subs, zh / en / zh-Hans / zh-Hant)
   - Tier 2: `yt-dlp --write-auto-subs` (auto-generated, zh / en)
   - Tier 3: `whisper` CLI (`openai-whisper`, Python) on `audio.mp3`
5. **Transcript** — `subtitle.vtt` is parsed into a clean, timestamp-free `transcript.txt`.
6. **Summary** — written by Claude when the skill is used inside Claude Code; the CLI alone does steps 1–5.

By default cookies are extracted from Chrome (`--cookies-from-browser chrome`) so YouTube's bot challenge and other authenticated content work out of the box. Pass `--no-cookies` to disable, or `--cookies-from-browser firefox` (etc.) to switch browsers.

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Bun ≥ 1.1 (TypeScript, no transpile step) |
| Download | yt-dlp |
| Demux / probe | ffmpeg / ffprobe |
| ASR | `whisper` CLI (openai-whisper, Python) |
| Lint / format | Biome |

The transcription path used to wrap `smart-whisper` (whisper.cpp via N-API) for in-process parallel inference, but Bun + Metal kept crashing during teardown. The current implementation just spawns the `whisper` CLI once per video — slower on long audio but rock-solid.

## Quick Start

### Install

```bash
git clone https://github.com/jokerlin/summarize-video
cd summarize-video
bun install
bun run skills/video-summarizer/scripts/install_deps.ts
# Installs/checks: ffmpeg, ffprobe, yt-dlp, openai-whisper (via pipx)
```

### Use

```bash
bun run summarize "https://www.youtube.com/watch?v=..."
```

Common flags:

```bash
# pick a different/faster Whisper model
bun run summarize "<URL>" --model tiny

# skip the mp4 download (audio + transcript only)
bun run summarize "<URL>" --skip-video

# use Firefox cookies instead of Chrome
bun run summarize "<URL>" --cookies-from-browser firefox

# disable cookies entirely
bun run summarize "<URL>" --no-cookies
```

See `bun run summarize --help` for the full flag list.

### Output

```
./downloads/
└── <Video_Title>/
    ├── video.mp4         # original video (≤ 1080p, mp4)
    ├── audio.mp3         # extracted audio
    ├── subtitle.vtt      # subtitles with timestamps
    ├── transcript.txt    # plain-text transcript
    ├── _metadata.json    # title / platform / url / duration / subtitleSource
    └── summary.md        # Claude generates this in skill mode
```

## Whisper Models

| Model | Size | Speed | Quality |
|---|---|---|---|
| tiny | 39 MB | Fastest | Basic |
| base | 74 MB | Fast | Good |
| **small** | 244 MB | Medium | **Default** |
| medium | 769 MB | Slow | Better |
| large-v3 | 1.5 GB | Slowest | Best |

Models auto-download from HuggingFace to `~/.cache/whisper/` on first use.

## Development

```bash
bun test           # unit tests
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun run format     # biome format --write
```

See `test/MANUAL.md` for the end-to-end smoke test procedure (YouTube / Bilibili / Twitter).

## License

MIT — see [LICENSE](./LICENSE)

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org/)
- [openai-whisper](https://github.com/openai/whisper)
