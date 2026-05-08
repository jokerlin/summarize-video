# Video Summarizer — TypeScript + Bun Port (Design Spec)

> Source project: `<source-dir>` (v1.1.1)
> Target: `<target-dir>` — 1:1 functional replica in TS + Bun
> Date: 2026-05-08
> Status: Approved (pending user review of this written spec)

## 1. Goal & Scope

Replicate the `video-summarizer` Claude Code plugin in TypeScript + Bun while preserving:

- The Claude Code Skill plugin layout (`.claude-plugin/` + `skills/video-summarizer/`)
- The 6-step workflow (deps → metadata → download → subtitles → transcript → summary)
- The 3-tier subtitle fallback (manual → auto → local ASR)
- The parallel ASR algorithm: silence-based splitting, smart split-point selection, parallel chunk transcription, time-offset merge
- The v1.1.1 robustness fix (filter split points beyond `duration - 0.5s`)
- All five output artifacts: `video.mp4`, `audio.mp3`, `subtitle.vtt`, `transcript.txt`, `summary.md`

Drop the Python/uv dependency entirely. Replace `faster-whisper` with `smart-whisper` (whisper.cpp via N-API). Replace `install_deps.sh` and `parallel_transcribe.py` with TS modules. Keep `yt-dlp` and `ffmpeg` as system tools.

Out of scope:

- Building an LLM API client. The CLI does not generate `summary.md` — Claude does that in skill mode (matches original).
- Cross-platform install testing. macOS is the validated target; Linux is best-effort, Windows untested (matches original CHANGELOG stance).
- Web UI / GUI.

## 2. Project Layout

```
summarize-video/
├── .claude-plugin/
│   ├── plugin.json              # name=video-summarizer, version=1.1.1
│   └── marketplace.json
├── skills/
│   └── video-summarizer/
│       ├── SKILL.md             # invokes `bun run summarize` instead of bash/python
│       ├── scripts/
│       │   └── install_deps.ts  # Bun script replacing install_deps.sh
│       └── reference/
│           └── summary-prompt.md  # unchanged from original
├── src/
│   ├── cli.ts                   # arg parser + main entry
│   ├── download.ts              # yt-dlp orchestration (video, audio, subs, metadata)
│   ├── subtitles.ts             # vtt/srt → transcript.txt
│   ├── transcribe.ts            # parallel ASR coordinator
│   ├── silence.ts               # ffmpeg silencedetect → silence-end timestamps
│   ├── splitter.ts              # findSplitPoints + splitAudio
│   ├── ffmpeg.ts                # thin wrapper: getDuration, runSilencedetect, cutSegment
│   ├── shell.ts                 # which, run (Bun.spawn wrapper), sanitizeTitle
│   ├── workers/
│   │   └── whisper-worker.ts    # one chunk → smart-whisper → segments
│   └── types.ts                 # Segment, ChunkTask, Metadata
├── test/
│   ├── splitter.test.ts
│   ├── silence.test.ts
│   ├── subtitles.test.ts
│   ├── shell.test.ts
│   ├── ffmpeg.test.ts
│   ├── fixtures/
│   │   ├── silence/*.txt        # canned ffmpeg stderr
│   │   └── subs/*.vtt|*.srt
│   └── MANUAL.md                # smoke-test URLs and procedure
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-08-video-summarizer-ts-port-design.md  # this file
├── package.json
├── tsconfig.json                # strict, NodeNext, types: ["bun-types"], noEmit: true
├── biome.json
├── bunfig.toml
├── README.md                    # ported from original (TS-flavored)
├── CHANGELOG.md                 # 2.0.0-ts entry; original entries kept
├── LICENSE                      # MIT
└── .gitignore                   # downloads/, node_modules/, dist/, *.log
```

### Tooling decisions

- **Runtime:** Bun (>=1.1). Native TypeScript, native Worker threads, `Bun.spawn`, `Bun.tempdir`.
- **Lint + format:** Biome (`biome check .`, `biome format --write .`).
- **Type check:** `tsc --noEmit` (note: `tsx` is a runtime, not a type checker — interpreted user request charitably).
- **Test:** `bun test` (built-in).
- **Whisper backend:** `smart-whisper` (N-API → whisper.cpp). Concurrent instances supported, no per-call subprocess overhead.

`package.json` scripts:

```json
{
  "scripts": {
    "summarize": "bun src/cli.ts",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "bin": { "summarize": "./src/cli.ts" }
}
```

## 3. Module Responsibilities

| Module | Exports | Depends on |
|---|---|---|
| `src/cli.ts` | `main()` | all below |
| `src/download.ts` | `getMetadata(url) → Metadata`, `downloadVideo(url, outDir)`, `downloadAudio(url, outDir)`, `downloadSubtitles(url, outDir)` (returns `"manual" \| "auto" \| null`) | `shell.ts` |
| `src/subtitles.ts` | `findSubtitleFile(dir)`, `vttToTranscript(path) → string`, `srtToTranscript(path) → string` | none |
| `src/transcribe.ts` | `transcribeParallel({input, outputDir, model, language, workers, minSegment})` (writes `subtitle.vtt` + `transcript.txt`); exports const `MAX_CONCURRENT_INFERENCE` | `silence`, `splitter`, `ffmpeg`, workers |
| `src/silence.ts` | `detectSilence(audioPath, noiseDb=-40, minDur=0.5) → number[]`; `parseSilenceDetectStderr(stderr, audioDuration) → number[]` (handles unmatched `silence_start` at EOF — see §5) | `ffmpeg.ts` |
| `src/splitter.ts` | `findSplitPoints(duration, silencePoints, target=30, min=10, max=45) → number[]` (drops trailing point if tail < min); `splitAudio(audioPath, splitPoints, outDir) → {path, startOffset}[]` | `ffmpeg.ts` |
| `src/ffmpeg.ts` | `getAudioDuration(path)`, `runSilenceDetect(...)`, `cutSegment(in, start, end, out)` | `shell.ts` |
| `src/workers/whisper-worker.ts` | (worker entry point, no exports). Receives `WorkerMessage`, posts `WorkerReply`. | `smart-whisper` |
| `src/shell.ts` | `which(bin) → string \| null`, `sanitizeTitle(s, max=80) → string`, `run(cmd, args, opts?) → {stdout, stderr, exitCode}`, `runStreaming(cmd, args, onStdout, onStderr) → exitCode` (line-buffered streaming for yt-dlp/ffmpeg progress) | Bun |
| `src/types.ts` | `Segment`, `ChunkTask`, `ChunkResult`, `Metadata`, and discriminated unions: `WorkerMessage = {type:'LOAD', model:string} \| {type:'TRANSCRIBE', task:ChunkTask} \| {type:'SHUTDOWN'}` and `WorkerReply = {type:'READY'} \| {type:'RESULT', result:ChunkResult} \| {type:'ERROR', chunkIdx, message}` | none |

### Whisper model resolution

`smart-whisper` requires a local ggml file path. `transcribe.ts` includes:

```ts
async function resolveModel(name: string): Promise<string> {
  const cacheDir = `${process.env.HOME}/.cache/whisper-models`;
  const file = `${cacheDir}/ggml-${name}.bin`;
  if (await Bun.file(file).exists()) return file;
  await Bun.spawn({ cmd: ["mkdir", "-p", cacheDir] }).exited;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
  // fetch + Bun.write with progress logged to stderr
  ...
  return file;
}
```

Model names: `tiny | base | small | medium | large-v3` (matches original CLI choices).

### Worker pool

`transcribeParallel` creates `effectiveWorkers = min(requested, chunks.length, MAX_CONCURRENT_INFERENCE)` `new Worker(new URL("./workers/whisper-worker.ts", import.meta.url), { type: "module" })` instances.

```ts
export const MAX_CONCURRENT_INFERENCE = Math.max(1, Math.floor(os.cpus().length / 4));
```

Why the cap: whisper.cpp uses OpenMP/Accelerate threading internally; running too many model instances in parallel causes thread contention and OOM (large-v3 weights are ~1.5 GB each). Capping at `cpus/4` keeps a 16-core machine at ≤ 4 concurrent inferences even if the user passes `--workers 16`. The original Python's default (`cpus/2`) didn't hit this because each Python process loaded its model fresh per chunk and was bottlenecked elsewhere; in our TS port the model lives across chunks per worker, so concurrency is the real bottleneck.

Each worker, on first `{type:'LOAD'}` message, calls `smart-whisper.load(model)` once and reuses the model for all subsequent `{type:'TRANSCRIBE'}` messages routed to it. Pool dispatches via a FIFO queue. On all-done, send `{type:'SHUTDOWN'}` then `worker.terminate()`. Failed chunks are caught at the pool level and recorded with empty `segments`; the job continues (matches Python's `except` block).

### Streaming subprocess output

`shell.ts` exports both:
- `run(cmd, args)` → buffered, returns `{stdout, stderr, exitCode}` — for short commands (e.g. `which`, `yt-dlp --print`)
- `runStreaming(cmd, args, onStdout, onStderr) → exitCode` — line-buffered via `proc.stdout.pipeThrough(new TextDecoderStream())` + `getReader()`, used for `yt-dlp` downloads and `ffmpeg` so we can forward `[download] 50.0%` progress lines to stderr in real time and avoid huge buffer accumulation on long downloads.

## 4. Data Flow

### Pipeline A — `cli.main(url)`

```
parse args (url, --model, --language=auto, --workers, --output, --cookies-from-browser)
  │
  ├─► getMetadata(url)
  │     yt-dlp --print "%(title)s\t%(duration)s\t%(uploader)s\t%(extractor)s\t%(language)s"
  │     → { title, duration, uploader, platform, language }
  │
  ├─► safeTitle = sanitizeTitle(title)            // /:*?"<>| → _, max 80 chars
  │   outDir   = (--output ?? "./downloads") + "/" + safeTitle
  │   mkdir -p outDir
  │
  ├─► downloadVideo(url, outDir)                  // yt-dlp -f bestvideo[h<=1080][mp4]+...
  │     → outDir/video.mp4
  │
  ├─► downloadAudio(url, outDir)                  // yt-dlp -x --audio-format mp3
  │     → outDir/audio.mp3
  │
  ├─► tier = downloadSubtitles(url, outDir)
  │     ├─ tier 1: --write-subs --sub-lang zh,en,zh-Hans,zh-Hant --skip-download
  │     │           glob outDir/subtitle*.vtt; non-empty → "manual"
  │     ├─ tier 2: --write-auto-subs --sub-lang zh,en --skip-download
  │     │           non-empty → "auto"
  │     └─ tier 3: null
  │
  ├─► IF tier in {manual, auto}:
  │      rename winning subtitle file → outDir/subtitle.vtt
  │      vttToTranscript(outDir/subtitle.vtt) → outDir/transcript.txt
  │   ELSE:
  │      transcribeParallel({input: outDir/audio.mp3, outputDir: outDir, ...})
  │      → outDir/subtitle.vtt + outDir/transcript.txt
  │
  ├─► write outDir/_metadata.json:
  │     { title, platform, url, duration, language, downloadTime: ISO8601 }
  │
  └─► print summary to stdout
```

### Pipeline B — `transcribeParallel`

```
duration = getAudioDuration(audio.mp3)
  │
  ├─ IF duration < minSegment (60s):
  │     single Worker → transcribe whole file → write VTT/TXT → done
  │
  ├─ silencePoints = detectSilence(audio.mp3, -40, 0.5)
  │
  ├─ splitPoints = findSplitPoints(duration, silencePoints, 30, 10, 45)
  │
  ├─ chunks = splitAudio(audio.mp3, splitPoints, tmpDir)
  │     // filters splitPoints < duration - 0.5  (v1.1.1 fix)
  │
  ├─ pool = WorkerPool(min(workers, chunks.length))
  │   for each chunk: pool.dispatch(ChunkTask) → ChunkResult
  │   on chunk error: log to stderr, segments = []
  │
  ├─ allSegments = merge(results)   // apply startOffset to each segment.start/end
  │
  ├─ writeVtt(allSegments, outDir/subtitle.vtt)
  └─ writeTranscript(allSegments, outDir/transcript.txt)

  finally: rm -rf tmpDir; pool.terminate()
```

### How Claude generates `summary.md` (skill mode)

`SKILL.md` step 6 instructs Claude:

1. Read `outDir/_metadata.json` → get TITLE, PLATFORM, URL, DURATION, LANGUAGE, DOWNLOAD_TIME.
2. Read `outDir/transcript.txt` → get TRANSCRIPT.
3. Read `$SKILL_DIR/reference/summary-prompt.md` → template with `{{...}}` placeholders.
4. Substitute placeholders, generate the structured summary, write to `outDir/summary.md`.

This matches the original SKILL.md step 6 semantically — Claude does both substitution and summarization. The CLI never touches `summary.md`.

## 5. `splitter.findSplitPoints` Algorithm (Port + Two Refinements)

```
function findSplitPoints(duration, silencePoints, target=30, min=10, max=45):
  if duration <= max: return []
  splitPoints = []
  lastSplit = 0.0

  for s in silencePoints:
    segLen = s - lastSplit
    if segLen >= target:
      if segLen <= max or splitPoints is empty:
        splitPoints.append(s); lastSplit = s
    elif segLen >= min and (s - lastSplit) > max * 0.8:
      splitPoints.append(s); lastSplit = s

  if splitPoints is empty and duration > max:
    n = int(duration / target) + 1
    for i in 1..n-1: splitPoints.append(i * target)

  // Refinement A: drop a trailing split point if it would create a
  // tail chunk shorter than `min` (avoids ~0.1s tails after the
  // v1.1.1 filter pulls a split point too close to EOF).
  while splitPoints.length > 0 and (duration - splitPoints[-1]) < min:
    splitPoints.pop()

  return splitPoints
```

The v1.1.1 safety filter lives in `splitAudio`, not `findSplitPoints`:

```
validSplitPoints = splitPoints.filter(sp => sp < duration - 0.5)
```

**Refinement A** (added per review feedback): the original Python could leave a too-short tail chunk after the EOF filter. We now trim trailing points whose tail-segment would be `< min` (default 10s). Test fixture covers `splits=[..., 119.8]` with `duration=120` — the 119.8 is dropped so the last chunk stays at full length.

### `silence.parseSilenceDetectStderr` notes

ffmpeg's `silencedetect` filter emits `silence_start: T` and `silence_end: T` interleaved on stderr. Edge case: a video that ends in silence will emit a final `silence_start` with **no matching `silence_end`** (the filter never sees the silence "close"). The parser:

1. Collects all `silence_end:` timestamps as split candidates (matches Python).
2. **Additionally:** if there's a trailing unmatched `silence_start: T` and `T < audioDuration`, treat `T` itself as a candidate too — the silent tail is a fine place to split. Pass `audioDuration` into the parser to enable this.

`parseSilenceDetectStderr` is exported from `silence.ts` so it can be unit-tested against fixtures without invoking ffmpeg.

## 6. Error Handling

| Failure | Handling |
|---|---|
| `yt-dlp` / `ffmpeg` / `ffprobe` not on PATH | Hard fail at start of `cli.main()`, message points to `install_deps.ts`. |
| `yt-dlp` exit ≠ 0 | Throw with stderr; suggest `--cookies-from-browser chrome`. |
| Title with `/:*?"<>\|` or > 80 chars | `sanitizeTitle()` strips only filesystem-reserved chars (POSIX + Windows: `/\:*?"<>\|` plus control chars `\x00-\x1f`), preserves Unicode (Emoji, CJK, RTL) verbatim, then truncates to 80 chars by code-point count (not byte length, so multi-byte CJK doesn't get split mid-codepoint). |
| Tier 1 yt-dlp returns 0 but `.vtt` is 0 bytes | Treated as failed; proceed to tier 2. |
| Empty audio / 0 duration | Throw before splitting. |
| `silencedetect` reports timestamp ≥ duration (the v1.1.1 bug) | `splitAudio` filters `sp < duration - 0.5`. Test fixture covers this. |
| `silence_start` at EOF without matching `silence_end` | Parser falls back to using `silence_start` as candidate when `< audioDuration` (see §5). |
| Audio < `minSegment` (60s) | Skip splitting; single-worker direct transcribe. |
| Audio ≥ `maxSegment` but **no silence at all** | Equal-length 30s hard cuts (last branch of `findSplitPoints`). |
| Whisper model missing | Auto-download to `~/.cache/whisper-models/`. Hard fail if download fails. |
| Single chunk worker throws | Caught by pool; chunk recorded as empty segments; job continues. |
| All chunks fail | Empty `subtitle.vtt`/`transcript.txt` written; exit code 2; summary "0/N succeeded". |
| Insufficient disk space | Before download: `statvfs`-equivalent check on `outDir`'s filesystem. Require ≥ 2 GB free for 1080p flow (rough heuristic: `video.mp4` ~1× source, `audio.mp3` ~10% of source, ASR chunks transient). Warn-only when below threshold; user can override with `--no-disk-check`. |
| Ctrl+C / SIGTERM | `process.on("SIGINT" \| "SIGTERM")` handler in `cli.ts`: send `{type:'SHUTDOWN'}` to all workers, `worker.terminate()`, `rm -rf tmpDir`, exit 130. `try/finally` in `transcribeParallel` is a second-line defense. No 300 MB chunk-piles left behind. |
| Existing files in `outDir` | Overwrite (matches original `yt-dlp -o`). No prompt. |
| `smart-whisper` native deps missing on macOS (no Xcode CLI Tools) | `install_deps.ts` runs `xcode-select -p` and prompts user to run `xcode-select --install` if absent. The `bun install` of `smart-whisper` will compile the N-API addon, which fails silently without it. |

### Logging convention

- **Stderr:** progress lines matching the Python script's prints (`Audio duration: 142.3s`, `Found 12 silence points`, `Will split into 5 chunks`, `Chunk 1/5 completed`).
- **Stdout:** final artifact list, machine-readable-ish:
  ```
  ✓ video.mp4
  ✓ audio.mp3
  ✓ subtitle.vtt    (source: manual | auto | whisper)
  ✓ transcript.txt
  ⚠ summary.md      (skill mode only — Claude generates this)
  ```

### Exit codes

- `0` — all artifacts produced, ≥ 1 chunk transcribed (if whisper used)
- `1` — hard failure before any artifact written
- `2` — partial success: at least one core artifact present, but ≥ 1 chunk failed
- `130` — interrupted (SIGINT)

## 7. Testing

### Unit tests (CI gate)

| File | Covers |
|---|---|
| `test/splitter.test.ts` | `findSplitPoints` heuristic edge cases, including: duration ≤ max, perfect 30s spacing, all-short-gaps fallback to equal cuts, silences containing values ≥ duration (combined with `splitAudio` filter check), **trailing-too-short trim (Refinement A)**: `splits=[30, 60, 90, 119.8]` with `duration=120, min=10` → trim → `[30, 60, 90]` |
| `test/silence.test.ts` | `parseSilenceDetectStderr` against fixtures: empty stderr, multiple silences, **trailing `silence_start` without `silence_end`** (silence-to-EOF), mixed lines, malformed lines tolerated |
| `test/subtitles.test.ts` | `vttToTranscript` and `srtToTranscript` against fixtures: simple VTT, VTT with `NOTE`/`Kind:`/`Language:`, multiline cues, simple SRT |
| `test/shell.test.ts` | `sanitizeTitle`: replaces filesystem-reserved chars + control chars, truncates to 80 **code points** (not bytes — verify CJK and Emoji), preserves Emoji/CJK/RTL verbatim |
| `test/ffmpeg.test.ts` | argv construction (mock `run`); no real ffmpeg call |

### Not unit-tested (deliberate)

- `download.ts` — network-bound
- `transcribe.ts` end-to-end — needs whisper model + audio
- `whisper-worker.ts` — covered by manual e2e
- `install_deps.ts` — manual on macOS

### Manual smoke tests (`test/MANUAL.md`)

Three URLs to run before tagging a release:

1. **YouTube with manual subs** → tier 1 + cleanup
2. **Bilibili with auto subs only** → tier 2
3. **Twitter/X (no subs)** → tier 3, with both a 30s clip (`transcribeDirect`) and a 5min clip (`transcribeParallel`)

### Coverage target

`bun test --coverage` ≥ 80% on `src/splitter.ts`, `src/silence.ts`, `src/subtitles.ts`, `src/shell.ts`. No coverage gate on network/worker modules.

## 8. CLI Reference

```
bun run summarize <url> [options]

Options:
  --model <name>            tiny | base | small (default) | medium | large-v3
  --language <code>         Language code or 'auto' (default: auto)
  --workers <n>             Parallel ASR workers (default: floor(CPU/2),
                            silently capped at MAX_CONCURRENT_INFERENCE = floor(CPU/4))
  --min-segment <sec>       Min duration to enable splitting (default: 60)
  --output <dir>            Root output dir (default: ./downloads)
  --cookies-from-browser <browser>   chrome | firefox | edge | safari
  --skip-video              Don't download video.mp4 (audio + subs + transcript only)
  --no-disk-check           Skip the pre-flight free-space warning
  --help                    Print usage
```

`--output` is a TS-port-only addition. All other flags map to the original parallel_transcribe.py + yt-dlp behavior.

## 9. Open Differences From Original (v1.1.1)

| # | Difference | Reason |
|---|---|---|
| 1 | No `uv`, no Python | TS+Bun port; Python toolchain dropped |
| 2 | `smart-whisper` (whisper.cpp / N-API) instead of `faster-whisper` (CTranslate2) | No pure-JS faster-whisper; user choice |
| 3 | `_metadata.json` written for Claude | Cleaner than bash env-var passthrough; replaces `TITLE=$(yt-dlp --print …)` |
| 4 | `--output` flag added | User-approved convenience |
| 5 | Worker pool reuses model across chunks (one load per worker, many chunks) | Original loads model per chunk (per Python process), so behavior differs slightly: TS port is more memory-efficient when chunks > workers |
| 6 | Whisper models cached at `~/.cache/whisper-models/` | smart-whisper doesn't auto-download |
| 7 | `marketplace.json` and CHANGELOG version bumped to 2.0.0-ts | Distinguish from upstream |
| 8 | **macOS GPU acceleration via CoreML / Metal** | When `smart-whisper` is built with CoreML support (default on macOS), inference runs on the Neural Engine / GPU with 3–10× speedup over CPU. The original Python (`faster-whisper` / CTranslate2) typically uses CPU on macOS unless CUDA is available. **This is a real upgrade for Apple Silicon users.** Documented in README. |
| 9 | Concurrency capped at `MAX_CONCURRENT_INFERENCE = floor(cpus/4)` | Original had no cap (Python ProcessPoolExecutor was implicitly bounded by per-chunk model load). Without this cap, large-v3 + 16 workers would OOM. |
| 10 | Live progress streaming for yt-dlp/ffmpeg | Original bash didn't stream; user just stared at the terminal. TS port forwards `[download] X%` lines as they arrive. |
| 11 | Disk space pre-check (warn) | Original had no check; user found out when ffmpeg failed mid-cut. |

## 10. Implementation Order (preview, full plan via writing-plans)

1. Bootstrap (package.json, tsconfig, biome.json, .gitignore, README skeleton)
2. `shell.ts` + `ffmpeg.ts` + tests
3. `silence.ts` + `splitter.ts` + tests (the algorithmically tricky parts — TDD)
4. `subtitles.ts` + tests
5. `download.ts` (manual smoke test on a YouTube URL)
6. `whisper-worker.ts` + `transcribe.ts` (manual smoke test on a short audio clip)
7. `cli.ts` end-to-end wiring
8. `install_deps.ts`
9. `.claude-plugin/` metadata + `SKILL.md` + `reference/summary-prompt.md`
10. README + CHANGELOG + final smoke-test pass on all three platforms

---

**Spec status:** Ready for user review.
