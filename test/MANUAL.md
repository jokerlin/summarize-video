# Manual Smoke Tests

Run before every release tag. Three URLs cover the three subtitle tiers and the
short/long ASR paths.

## Pre-flight

```bash
bun install
bun run skills/video-summarizer/scripts/install_deps.ts
bun test                # unit tests should pass
```

## Test 1 — YouTube with manual subtitles (Tier 1)

```bash
bun run summarize "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

Expected:
- `_metadata.json` shows `subtitleSource: "manual"`
- `subtitle.vtt` has WEBVTT header and timestamps
- `transcript.txt` is non-empty, no timestamps
- No whisper model download
- Total runtime ≤ 30 seconds (network-dependent)

## Test 2 — Bilibili with auto-generated subtitles (Tier 2)

Pick any short Bilibili video known to have auto subs but no manual ones.

```bash
bun run summarize "https://www.bilibili.com/video/BV1xx411c7mD" --cookies-from-browser chrome
```

Expected:
- `_metadata.json` shows `subtitleSource: "auto"`
- All five output files present

## Test 3 — Twitter/X (Tier 3 — local Whisper)

### 3a. Short clip (<60s) — direct path

```bash
bun run summarize "https://x.com/user/status/<id-of-30s-clip>"
```

Expected stderr:
```
Audio is short, transcribing directly...
```

### 3b. Longer clip (5min) — parallel path

```bash
bun run summarize "https://x.com/user/status/<id-of-5min-clip>"
```

Expected stderr:
```
Audio duration: 300.0s
Detecting silence points...
Found N silence points
Will split into M chunks
Transcribing M chunks with K workers...
  Chunk 1/M completed
  ...
Merging segments...
```

### 3c. Failure injection

Kill ffmpeg mid-run and verify cleanup:

```bash
bun run summarize "<long-video-url>"
# In another terminal:
pkill -INT bun
```

Expected:
- "Received SIGINT, cleaning up..." printed
- No leftover `chunk_NNN.mp3` files in `/tmp/video-summarizer-*/`
- No zombie ffmpeg/Worker processes (`ps aux | grep -E 'ffmpeg|whisper'`)

## Sign-off Checklist

- [ ] Test 1 passed (manual subs, no whisper)
- [ ] Test 2 passed (auto subs)
- [ ] Test 3a passed (whisper short path)
- [ ] Test 3b passed (whisper parallel path)
- [ ] Test 3c passed (cleanup on SIGINT)
- [ ] No regressions in `bun test`
- [ ] No type errors in `bun run typecheck`
- [ ] No lint errors in `bun run lint`
