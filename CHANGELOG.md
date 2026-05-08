# Changelog

## [2.0.0] - 2026-05-08

### Added
- TypeScript + Bun rewrite of upstream `liang121/video-summarizer` (v1.1.1)
- `smart-whisper` (whisper.cpp / N-API) replaces `faster-whisper`
- Bun Worker pool replaces Python `ProcessPoolExecutor`
- `MAX_CONCURRENT_INFERENCE = floor(CPU/4)` cap to prevent OOM on large-v3
- Live yt-dlp/ffmpeg progress streaming
- Disk-space pre-flight warning (`--no-disk-check` to suppress)
- `--output` flag to choose root output dir
- macOS CoreML/Metal acceleration (when smart-whisper is built with CoreML support)
- `_metadata.json` artifact written for Claude to consume in Step 6

### Preserved (1:1 with upstream)
- 3-tier subtitle fallback: manual → auto → local Whisper
- Silence-based splitting (`silencedetect=noise=-40dB:d=0.5`)
- Smart split-point heuristic (target 30s, range [10s, 45s])
- v1.1.1 split-point safety filter (`sp < duration - 0.5`)
- Per-chunk failure isolation (failed chunks → empty segments, job continues)
- Output artifacts: video.mp4, audio.mp3, subtitle.vtt, transcript.txt, summary.md
- Skill plugin layout (`.claude-plugin/`, `skills/video-summarizer/`)
- summary-prompt.md template (verbatim)

### Refinement Over Upstream
- Splitter trims trailing split point if tail-segment < min (avoids ~0.1s tails)
- Silence parser falls back to `silence_start` when video ends in silence

### Dropped
- Python / `uv` dependency
- `install_deps.sh` (replaced by `install_deps.ts`)
- `parallel_transcribe.py` (replaced by `src/transcribe.ts` + `src/workers/whisper-worker.ts`)
