# Video Summarizer (TypeScript + Bun)

A 1:1 functional port of [`liang121/video-summarizer`](https://github.com/liang121/video-summarizer) (v1.1.1) to TypeScript + Bun. Downloads videos from 1800+ platforms (yt-dlp), extracts subtitles or runs local Whisper ASR (smart-whisper / whisper.cpp), and prepares a Claude-ready summary package.

> **Note:** This is a skill for Claude Code CLI. Not affiliated with Anthropic.

## Differences From Upstream

| What | Upstream (Python) | This port (TS+Bun) |
|---|---|---|
| Runtime | Python 3.8+ via `uv` | Bun ≥ 1.1 |
| ASR engine | `faster-whisper` (CTranslate2) | `smart-whisper` (whisper.cpp / N-API) |
| Parallel ASR | `ProcessPoolExecutor`, model per chunk | Bun Workers, model per worker (more memory-efficient) |
| Concurrency cap | none (implicit Python overhead) | `MAX_CONCURRENT_INFERENCE = floor(CPU/4)` |
| GPU acceleration on macOS | CPU only by default | CoreML / Metal via whisper.cpp (3–10× faster on Apple Silicon) |
| Progress streaming | none | live yt-dlp/ffmpeg progress to stderr |
| Disk space check | none | warn-only pre-flight |
| `--output` flag | not present | added |

Everything else (3-tier subtitle fallback, silence-based splitting, v1.1.1 split-point safety filter, output layout) is preserved.

## Quick Start

### Install

```bash
git clone https://github.com/jokerlin/summarize-video
cd summarize-video
bun install
bun run skills/video-summarizer/scripts/install_deps.ts   # ffmpeg, yt-dlp
```

### Use

```bash
bun run summarize "https://www.youtube.com/watch?v=..."
```

Options: see `bun run summarize --help`.

### Output

```
./downloads/
└── <Video_Title>/
    ├── video.mp4
    ├── audio.mp3
    ├── subtitle.vtt
    ├── transcript.txt
    ├── _metadata.json
    └── summary.md     # Claude generates this in skill mode
```

## Whisper Models

| Model | Size | Speed | Quality |
|---|---|---|---|
| tiny | 39 MB | Fastest | Basic |
| base | 74 MB | Fast | Good |
| **small** | 244 MB | Medium | **Default** |
| medium | 769 MB | Slow | Better |
| large-v3 | 1.5 GB | Slowest | Best |

Models auto-download from HuggingFace to `~/.cache/whisper-models/` on first use.

## Development

```bash
bun test           # unit tests
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
bun run format     # biome format --write
```

See `test/MANUAL.md` for end-to-end smoke test procedure (YouTube / Bilibili / Twitter).

## License

MIT — see [LICENSE](./LICENSE)

## Credits

- Upstream design: [liang121/video-summarizer](https://github.com/liang121/video-summarizer)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org/), [whisper.cpp](https://github.com/ggerganov/whisper.cpp), [smart-whisper](https://github.com/MichaelMartzy/smart-whisper)
