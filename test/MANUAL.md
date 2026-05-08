# Manual Smoke Tests

Run before every release tag. Three URLs cover the three subtitle tiers.

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
- No whisper invocation
- Total runtime ≤ 30 seconds (network-dependent)

## Test 2 — Bilibili with auto-generated subtitles (Tier 2)

Pick any short Bilibili video known to have auto subs but no manual ones.

```bash
bun run summarize "https://www.bilibili.com/video/BV1xx411c7mD"
```

(Default cookies = Chrome; pass `--cookies-from-browser firefox` if needed.)

Expected:
- `_metadata.json` shows `subtitleSource: "auto"`
- All five output files present

## Test 3 — Whisper fallback (Tier 3)

Pick any short video known to have NO manual or auto subs (Twitter/X clips often qualify).

```bash
bun run summarize "https://x.com/user/status/<id>"
```

Expected stderr:
```
Trying to fetch subtitles...
Running whisper-cli (model=base, language=auto, GPU=Metal)...
```

Expected:
- `_metadata.json` shows `subtitleSource: "whisper"`
- `subtitle.vtt` and `transcript.txt` non-empty
- `video.mp4` does NOT exist (audio-only by default; use `--with-video` to include it)

### 3b. Failure injection

Kill mid-run and verify cleanup:

```bash
bun run summarize "<long-video-url>"
# In another terminal:
pkill -INT bun
```

Expected:
- "Received SIGINT, cleaning up..." printed
- No zombie yt-dlp / whisper-cli / ffmpeg processes (`ps aux | grep -E 'yt-dlp|whisper|ffmpeg'`)

### 3c. --with-video

```bash
bun run summarize "<URL>" --with-video
```

Expected:
- All output files present, **including** `video.mp4`

## Sign-off Checklist

- [ ] Test 1 passed (manual subs, no whisper)
- [ ] Test 2 passed (auto subs)
- [ ] Test 3 passed (whisper CLI)
- [ ] Test 3b passed (cleanup on SIGINT)
- [ ] No regressions in `bun test`
- [ ] No type errors in `bun run typecheck`
- [ ] No lint errors in `bun run lint`
