# Changelog

## [3.1.0] - 2026-05-09

### Added
- `--with-audio` flag — keep `audio.mp3` in the output even when Tier 1/2 subtitles
  were used (audio is otherwise skipped to save bandwidth).

### Changed
- **Subs-first pipeline.** Subtitle detection now runs *before* `audio.mp3` is
  downloaded. When manual or auto subtitles exist (Tier 1/2), no audio is
  fetched. For talks/podcasts on YouTube this typically cuts a 12-min run from
  ~30 s down to <10 s.
- Output guarantees revised: `audio.mp3` is now conditional (whisper ran OR
  `--with-audio` was passed). `subtitle.vtt` and `transcript.txt` are still
  always present.
- Docs (README / README.zh-CN / SKILL.md / MANUAL.md) and plugin manifests
  refreshed for the new defaults.

### Fixed
- v3.0.0 regression where `audio.mp3` was always downloaded even when subtitles
  were available — the audio download now only happens when whisper actually
  has to run.

## [3.0.0] - 2026-05-08

### Added
- `--with-video` flag (default off). Audio + transcript only by default; pass
  this to also download `video.mp4`. (Inverts the old `--skip-video`.)
- `--with-audio` placeholder behavior: audio is downloaded when whisper has to
  run; otherwise nothing extra. (Promoted to an explicit flag in v3.1.0.)
- README split into English + 简体中文 (`README.zh-CN.md`); badges, How-It-Works
  diagram, model-comparison table.
- Claude Code plugin install instructions in README (`/plugin marketplace add`,
  `/plugin install video-summarizer@video-summarizer`).

### Changed
- **ASR backend: whisper.cpp's `whisper-cli`** (Metal-accelerated on Apple
  Silicon). Replaces the v2.x `smart-whisper` N-API addon and the brief
  openai-whisper Python CLI experiment.
  - 12-min audio: ~17 s on M2 Pro vs. ~6 m 50 s with openai-whisper (~25×).
  - whisper-cli accepts mp3 directly — no PCM conversion needed.
  - Models cached at `~/.cache/whisper-cpp/`, downloaded via curl with progress.
- **Default Whisper model: `base`** (was `small`). Sufficient quality at the
  faster runtime; saves ~170 MB on first download.
- **Default cookies: `--cookies-from-browser chrome`**. YouTube's bot challenge
  works out of the box. Pass `--no-cookies` to disable, or
  `--cookies-from-browser <browser>` to switch.
- `install_deps.ts` now installs `whisper-cpp` via Homebrew (was: openai-whisper
  via pipx; was: bun-install + node-gyp rebuild of smart-whisper).
- Plugin manifest description, keywords, and version aligned with the new
  toolchain.

### Removed
- `smart-whisper` dependency, `WorkerPool`, parallel chunking, silence
  detection, splitter — net **−854 lines**. whisper-cli handles long audio
  internally.
- `--workers`, `--min-segment` flags (no longer relevant).
- `--skip-video` flag (replaced by inverted `--with-video`).
- Reference to upstream `liang121/video-summarizer` in README/credits — the
  project has diverged enough to stand on its own.

### Fixed
- `Bun.write(path, response)` hung when streaming a large HuggingFace download
  in some sandboxed environments. Switched to `curl -fL --progress-bar`.

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

## [1.0.0] - 2026-05-08

### Origin

This repository began as a TypeScript + Bun port of the upstream open-source
project:

- **Source project:** [`liang121/video-summarizer`](https://github.com/liang121/video-summarizer) (v1.1.1)
- **License:** MIT
- **Author:** [@liang121](https://github.com/liang121)

The upstream is a Python implementation built on `yt-dlp`, `ffmpeg`, and
`faster-whisper` (CTranslate2). The original 3-tier subtitle fallback
(manual → auto → local Whisper), silence-based audio splitting, and the
`summary-prompt.md` template all originated there. Subsequent versions in this
repo (2.0.0 onward) reimplement the pipeline in TypeScript and have since
diverged in toolchain (whisper.cpp / whisper-cli) and defaults; see the 2.0.0
and 3.0.0 entries above for the divergence trail.

Many thanks to the upstream author for the original design.
