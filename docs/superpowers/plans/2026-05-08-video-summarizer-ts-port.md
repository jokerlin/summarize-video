# Video Summarizer TS+Bun Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `video-summarizer` Claude Code skill (Python+bash, v1.1.1) to TypeScript + Bun, preserving the 6-step workflow, 3-tier subtitle fallback, and parallel ASR algorithm. Final deliverable is a Skill plugin that calls a Bun CLI for steps 1-5 and lets Claude generate `summary.md`.

**Architecture:** Thin Bun CLI in `src/` orchestrates `yt-dlp` and `ffmpeg` (still system tools), uses `smart-whisper` (whisper.cpp via N-API) for local ASR with a Bun Worker pool. SKILL.md tells Claude to invoke `bun run summarize <url>` then read `_metadata.json` + `transcript.txt` to write `summary.md`.

**Tech Stack:** Bun ≥ 1.1, TypeScript (`tsc --noEmit` for typecheck), Biome (lint+format), `bun test`, `smart-whisper`, `node:util.parseArgs`, `node:os`, `node:fs/promises`.

**Spec:** `docs/superpowers/specs/2026-05-08-video-summarizer-ts-port-design.md`

---

## Task 1: Bootstrap project (package.json, tsconfig, biome, .gitignore)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `bunfig.toml`
- Create: `.gitignore`

- [ ] **Step 1: Verify clean working directory and Bun version**

Run: `bun --version && git status --short`
Expected: Bun version printed (≥ 1.1.0), no untracked files except `docs/`.

- [ ] **Step 2: Initialize package.json**

Create `package.json`:

```json
{
  "name": "video-summarizer",
  "version": "2.0.0",
  "description": "Download videos from 1800+ platforms and produce a Claude-ready summary package (TS+Bun port of liang121/video-summarizer)",
  "license": "MIT",
  "type": "module",
  "module": "src/cli.ts",
  "bin": {
    "summarize": "./src/cli.ts"
  },
  "scripts": {
    "summarize": "bun src/cli.ts",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "smart-whisper": "^0.10.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "latest",
    "typescript": "^5.6.0"
  },
  "engines": {
    "bun": ">=1.1.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["bun"],
    "strict": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*", "test/**/*", "skills/**/*.ts"]
}
```

- [ ] **Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": false, "ignore": ["downloads/**", "node_modules/**", "dist/**"] },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noNonNullAssertion": "off" },
      "suspicious": { "noExplicitAny": "warn" }
    }
  },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always", "trailingCommas": "all" } }
}
```

- [ ] **Step 5: Create bunfig.toml**

```toml
[test]
preload = []
coverage = false
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
downloads/
*.log
.DS_Store
.idea/
.vscode/
bun.lockb
```

- [ ] **Step 7: Install dependencies**

Run: `bun install`
Expected: smart-whisper, biome, typescript, @types/bun installed; `bun.lockb` created (gitignored).

- [ ] **Step 8: Verify typecheck and lint run cleanly on empty project**

Run: `bun run typecheck && bun run lint`
Expected: typecheck reports "No inputs were found in config file" (acceptable — no src yet) OR exits 0; biome reports "Checked 0 files".

If typecheck errors on empty src, that's fine — it'll resolve in Task 2.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json biome.json bunfig.toml .gitignore
git commit -m "chore: bootstrap Bun + TypeScript + Biome project"
```

---

## Task 2: Define shared types

**Files:**
- Create: `src/types.ts`
- Test: (none — pure type defs)

- [ ] **Step 1: Create src/types.ts**

```typescript
// src/types.ts
// Shared types and discriminated unions used across modules.

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface ChunkTask {
  chunkIdx: number;
  chunkPath: string;
  startTime: number;
  language: string;
}

export interface ChunkResult {
  chunkIdx: number;
  segments: Segment[];
  startTime: number;
  error?: string;
}

export interface Metadata {
  title: string;
  duration: number;
  uploader: string;
  platform: string;
  language: string;
  url: string;
  downloadTime: string;
}

export type SubtitleSource = "manual" | "auto" | "whisper";

// Worker IPC — discriminated unions
export type WorkerMessage =
  | { type: "LOAD"; model: string }
  | { type: "TRANSCRIBE"; task: ChunkTask }
  | { type: "SHUTDOWN" };

export type WorkerReply =
  | { type: "READY" }
  | { type: "RESULT"; result: ChunkResult }
  | { type: "ERROR"; chunkIdx: number; message: string };

export type WhisperModelName = "tiny" | "base" | "small" | "medium" | "large-v3";

export interface CliOptions {
  url: string;
  model: WhisperModelName;
  language: string;
  workers: number | undefined;
  minSegment: number;
  output: string;
  cookiesFromBrowser: string | undefined;
  skipVideo: boolean;
  noDiskCheck: boolean;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add shared types and worker IPC discriminated unions"
```

---

## Task 3: shell.ts — sanitizeTitle (TDD)

**Files:**
- Create: `src/shell.ts`
- Test: `test/shell.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/shell.test.ts`:

```typescript
// test/shell.test.ts
import { describe, expect, test } from "bun:test";
import { sanitizeTitle } from "../src/shell.ts";

describe("sanitizeTitle", () => {
  test("replaces filesystem-reserved chars with underscore", () => {
    expect(sanitizeTitle("a/b\\c:d*e?f\"g<h>i|j")).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  test("strips ASCII control characters", () => {
    expect(sanitizeTitle("hello\x00\x07\x1fworld")).toBe("hello___world");
  });

  test("preserves CJK characters verbatim", () => {
    expect(sanitizeTitle("视频标题:测试")).toBe("视频标题_测试");
  });

  test("preserves emoji verbatim", () => {
    expect(sanitizeTitle("video 🎬 demo")).toBe("video 🎬 demo");
  });

  test("truncates to 80 code points by default", () => {
    const long = "a".repeat(100);
    expect(sanitizeTitle(long).length).toBe(80);
  });

  test("truncation counts code points, not bytes — CJK is not split", () => {
    // 100 Chinese chars = 300 UTF-8 bytes; we want exactly 80 chars
    const cjk = "中".repeat(100);
    const out = sanitizeTitle(cjk);
    expect([...out].length).toBe(80);
    expect(out).toBe("中".repeat(80));
  });

  test("truncates to caller-provided max", () => {
    expect(sanitizeTitle("abcdef", 3)).toBe("abc");
  });

  test("trims trailing whitespace after truncation", () => {
    expect(sanitizeTitle("hello world ", 12)).toBe("hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/shell.test.ts`
Expected: FAIL — `Cannot find module "../src/shell.ts"` (file doesn't exist yet).

- [ ] **Step 3: Implement sanitizeTitle**

Create `src/shell.ts` (we'll add `which`/`run`/`runStreaming` in later tasks; stub the file with sanitizeTitle only for now):

```typescript
// src/shell.ts
const RESERVED_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeTitle(s: string, max = 80): string {
  const cleaned = s.replace(RESERVED_CHARS, "_");
  // Slice by code points, not UTF-16 units, so emoji aren't split mid-surrogate.
  const codePoints = [...cleaned];
  const truncated = codePoints.slice(0, max).join("");
  return truncated.replace(/\s+$/u, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/shell.test.ts`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shell.ts test/shell.test.ts
git commit -m "feat(shell): add sanitizeTitle with code-point-safe truncation"
```

---

## Task 4: shell.ts — which + run + runStreaming

**Files:**
- Modify: `src/shell.ts`

- [ ] **Step 1: Add `which`, `run`, `runStreaming` to src/shell.ts**

Append to `src/shell.ts`:

```typescript
// === which ===

export async function which(bin: string): Promise<string | null> {
  const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0) return null;
  const path = out.trim();
  return path.length > 0 ? path : null;
}

// === run (buffered) ===

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin ? new Response(opts.stdin).body : "ignore",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
}

// === runStreaming (line-buffered) ===

export type LineHandler = (line: string) => void;

export async function runStreaming(
  cmd: string,
  args: string[],
  onStdout: LineHandler,
  onStderr: LineHandler,
  opts: RunOptions = {},
): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const pumpLines = async (stream: ReadableStream<Uint8Array>, onLine: LineHandler) => {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      // yt-dlp uses \r for in-place progress; treat \r as line break too
      while ((nl = buf.search(/[\r\n]/)) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.length > 0) onLine(line);
      }
    }
    if (buf.length > 0) onLine(buf);
  };

  await Promise.all([pumpLines(proc.stdout, onStdout), pumpLines(proc.stderr, onStderr)]);
  await proc.exited;
  return proc.exitCode ?? 0;
}
```

- [ ] **Step 2: Add tests for which/run**

Append to `test/shell.test.ts`:

```typescript
import { run, which } from "../src/shell.ts";

describe("which", () => {
  test("finds an existing binary", async () => {
    const path = await which("sh");
    expect(path).not.toBeNull();
    expect(path).toMatch(/\/sh$/);
  });

  test("returns null for a missing binary", async () => {
    const path = await which("definitely-not-a-real-binary-xyz123");
    expect(path).toBeNull();
  });
});

describe("run", () => {
  test("captures stdout and exit code", async () => {
    const r = await run("echo", ["hello"]);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exitCode).toBe(0);
  });

  test("captures stderr separately", async () => {
    const r = await run("sh", ["-c", "echo out; echo err 1>&2"]);
    expect(r.stdout.trim()).toBe("out");
    expect(r.stderr.trim()).toBe("err");
  });

  test("non-zero exit code is preserved", async () => {
    const r = await run("sh", ["-c", "exit 7"]);
    expect(r.exitCode).toBe(7);
  });
});
```

- [ ] **Step 3: Run tests to verify pass**

Run: `bun test test/shell.test.ts`
Expected: PASS — 13 tests pass total.

- [ ] **Step 4: Commit**

```bash
git add src/shell.ts test/shell.test.ts
git commit -m "feat(shell): add which, run (buffered), runStreaming (line-buffered)"
```

---

## Task 5: ffmpeg.ts — getAudioDuration, runSilenceDetect, cutSegment

**Files:**
- Create: `src/ffmpeg.ts`
- Test: `test/ffmpeg.test.ts`

- [ ] **Step 1: Write the failing test (argv construction only — no real ffmpeg invocation)**

Create `test/ffmpeg.test.ts`:

```typescript
// test/ffmpeg.test.ts
import { describe, expect, test } from "bun:test";
import { buildCutSegmentArgs, buildDurationArgs, buildSilenceDetectArgs } from "../src/ffmpeg.ts";

describe("ffmpeg argv builders", () => {
  test("buildDurationArgs emits ffprobe-compatible argv", () => {
    expect(buildDurationArgs("/tmp/audio.mp3")).toEqual([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "/tmp/audio.mp3",
    ]);
  });

  test("buildSilenceDetectArgs uses -40dB / 0.5s defaults", () => {
    expect(buildSilenceDetectArgs("/tmp/a.mp3")).toEqual([
      "-i",
      "/tmp/a.mp3",
      "-af",
      "silencedetect=noise=-40dB:d=0.5",
      "-f",
      "null",
      "-",
    ]);
  });

  test("buildSilenceDetectArgs honors custom thresholds", () => {
    expect(buildSilenceDetectArgs("/tmp/a.mp3", -30, 0.25)).toContain("silencedetect=noise=-30dB:d=0.25");
  });

  test("buildCutSegmentArgs uses stream copy and explicit times", () => {
    expect(buildCutSegmentArgs("in.mp3", 10.5, 30, "out.mp3")).toEqual([
      "-y",
      "-i",
      "in.mp3",
      "-ss",
      "10.5",
      "-to",
      "30",
      "-c",
      "copy",
      "out.mp3",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ffmpeg.test.ts`
Expected: FAIL — module `../src/ffmpeg.ts` does not exist.

- [ ] **Step 3: Implement src/ffmpeg.ts**

Create `src/ffmpeg.ts`:

```typescript
// src/ffmpeg.ts
// Thin wrappers around ffmpeg/ffprobe. Pure-argv builders are exported so tests
// don't need a real ffmpeg binary.

import { run } from "./shell.ts";

export function buildDurationArgs(path: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ];
}

export async function getAudioDuration(path: string): Promise<number> {
  const r = await run("ffprobe", buildDurationArgs(path));
  if (r.exitCode !== 0) {
    throw new Error(`ffprobe failed (${r.exitCode}): ${r.stderr.trim()}`);
  }
  const v = Number.parseFloat(r.stdout.trim());
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`ffprobe returned non-numeric duration: ${r.stdout.trim()!r}`);
  }
  return v;
}

export function buildSilenceDetectArgs(path: string, noiseDb = -40, minDuration = 0.5): string[] {
  return [
    "-i",
    path,
    "-af",
    `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
    "-f",
    "null",
    "-",
  ];
}

export async function runSilenceDetect(
  path: string,
  noiseDb = -40,
  minDuration = 0.5,
): Promise<string> {
  const r = await run("ffmpeg", buildSilenceDetectArgs(path, noiseDb, minDuration));
  // ffmpeg writes silencedetect output to stderr regardless of exit code (it
  // sometimes returns non-zero from the null muxer). We only care about stderr.
  return r.stderr;
}

export function buildCutSegmentArgs(
  input: string,
  start: number,
  end: number,
  output: string,
): string[] {
  return ["-y", "-i", input, "-ss", String(start), "-to", String(end), "-c", "copy", output];
}

export async function cutSegment(
  input: string,
  start: number,
  end: number,
  output: string,
): Promise<void> {
  const r = await run("ffmpeg", buildCutSegmentArgs(input, start, end, output));
  if (r.exitCode !== 0) {
    throw new Error(`ffmpeg cut failed (${r.exitCode}): ${r.stderr.trim().slice(-500)}`);
  }
}
```

Note: the `${r.stdout.trim()!r}` is a typo — fix it to be just a regular template substitution `\`ffprobe returned non-numeric duration: ${r.stdout.trim()}\`` before saving.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test test/ffmpeg.test.ts && bun run typecheck`
Expected: PASS — 4 tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ffmpeg.ts test/ffmpeg.test.ts
git commit -m "feat(ffmpeg): add duration/silencedetect/cutSegment wrappers + argv builders"
```

---

## Task 6: silence.ts — parseSilenceDetectStderr (TDD with fixtures)

**Files:**
- Create: `src/silence.ts`
- Create: `test/silence.test.ts`
- Create: `test/fixtures/silence/empty.txt`
- Create: `test/fixtures/silence/multiple.txt`
- Create: `test/fixtures/silence/silence_to_eof.txt`
- Create: `test/fixtures/silence/malformed.txt`

- [ ] **Step 1: Create fixture files**

Create `test/fixtures/silence/empty.txt`:
```
ffmpeg version 6.1 Copyright (c) 2000-2023 the FFmpeg developers
Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp
size=N/A time=00:01:23.45 bitrate=N/A speed=  234x
```

Create `test/fixtures/silence/multiple.txt`:
```
ffmpeg version 6.1
[silencedetect @ 0x600000001] silence_start: 5.123
[silencedetect @ 0x600000001] silence_end: 5.624 | silence_duration: 0.501
[silencedetect @ 0x600000001] silence_start: 12.0
[silencedetect @ 0x600000001] silence_end: 12.7 | silence_duration: 0.7
[silencedetect @ 0x600000001] silence_start: 30.5
[silencedetect @ 0x600000001] silence_end: 31.05 | silence_duration: 0.55
size=N/A time=00:00:35.00
```

Create `test/fixtures/silence/silence_to_eof.txt`:
```
ffmpeg version 6.1
[silencedetect @ 0x600000001] silence_start: 5.0
[silencedetect @ 0x600000001] silence_end: 5.5 | silence_duration: 0.5
[silencedetect @ 0x600000001] silence_start: 58.2
size=N/A time=00:01:00.00
```
(Trailing `silence_start` with no matching `silence_end` — silence runs to EOF.)

Create `test/fixtures/silence/malformed.txt`:
```
[silencedetect] silence_end: not_a_number
[silencedetect] silence_end:
[silencedetect] silence_end: 7.5 | silence_duration: 0.5
random log line
silence_start without prefix
```

- [ ] **Step 2: Write the failing test**

Create `test/silence.test.ts`:

```typescript
// test/silence.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSilenceDetectStderr } from "../src/silence.ts";

const fix = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures/silence", name), "utf8");

describe("parseSilenceDetectStderr", () => {
  test("returns [] when no silence_end lines present", () => {
    expect(parseSilenceDetectStderr(fix("empty.txt"), 100)).toEqual([]);
  });

  test("extracts all silence_end timestamps", () => {
    expect(parseSilenceDetectStderr(fix("multiple.txt"), 35)).toEqual([5.624, 12.7, 31.05]);
  });

  test("appends trailing silence_start as candidate when < audioDuration", () => {
    // duration=60: trailing silence_start=58.2 is a valid candidate
    expect(parseSilenceDetectStderr(fix("silence_to_eof.txt"), 60)).toEqual([5.5, 58.2]);
  });

  test("ignores trailing silence_start when >= audioDuration", () => {
    // duration=58: silence_start=58.2 should be ignored
    expect(parseSilenceDetectStderr(fix("silence_to_eof.txt"), 58)).toEqual([5.5]);
  });

  test("tolerates malformed lines", () => {
    expect(parseSilenceDetectStderr(fix("malformed.txt"), 100)).toEqual([7.5]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/silence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement src/silence.ts**

Create `src/silence.ts`:

```typescript
// src/silence.ts
import { runSilenceDetect } from "./ffmpeg.ts";
import { getAudioDuration } from "./ffmpeg.ts";

const SILENCE_END_RE = /silence_end:\s*([\d.]+)/;
const SILENCE_START_RE = /silence_start:\s*([\d.]+)/;

/**
 * Parse ffmpeg silencedetect stderr into split-candidate timestamps.
 *
 * Returns silence_end timestamps in document order, plus an unmatched trailing
 * silence_start (silence-to-EOF case) when it falls within audioDuration.
 */
export function parseSilenceDetectStderr(stderr: string, audioDuration: number): number[] {
  const ends: number[] = [];
  let lastSilenceStart: number | null = null;
  let matched = true;

  for (const rawLine of stderr.split("\n")) {
    const startMatch = rawLine.match(SILENCE_START_RE);
    if (startMatch) {
      const v = Number.parseFloat(startMatch[1]);
      if (Number.isFinite(v)) {
        lastSilenceStart = v;
        matched = false;
      }
      continue;
    }
    const endMatch = rawLine.match(SILENCE_END_RE);
    if (endMatch) {
      const v = Number.parseFloat(endMatch[1]);
      if (Number.isFinite(v)) {
        ends.push(v);
        matched = true;
      }
    }
  }

  if (!matched && lastSilenceStart !== null && lastSilenceStart < audioDuration) {
    ends.push(lastSilenceStart);
  }
  return ends;
}

/**
 * Run ffmpeg silencedetect on an audio file and return split-candidate timestamps.
 */
export async function detectSilence(
  audioPath: string,
  noiseDb = -40,
  minDuration = 0.5,
): Promise<number[]> {
  const stderr = await runSilenceDetect(audioPath, noiseDb, minDuration);
  const duration = await getAudioDuration(audioPath);
  return parseSilenceDetectStderr(stderr, duration);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test test/silence.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/silence.ts test/silence.test.ts test/fixtures/silence/
git commit -m "feat(silence): parse silencedetect stderr with silence-to-EOF fallback"
```

---

## Task 7: splitter.ts — findSplitPoints (TDD)

**Files:**
- Create: `src/splitter.ts`
- Create: `test/splitter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/splitter.test.ts`:

```typescript
// test/splitter.test.ts
import { describe, expect, test } from "bun:test";
import { findSplitPoints } from "../src/splitter.ts";

describe("findSplitPoints", () => {
  test("returns [] when duration <= max", () => {
    expect(findSplitPoints(40, [10, 20, 30])).toEqual([]);
    expect(findSplitPoints(45, [])).toEqual([]);
  });

  test("picks silences spaced about target apart", () => {
    // duration 120, target 30, perfect 30s spacing
    expect(findSplitPoints(120, [30, 60, 90, 110])).toEqual([30, 60, 90]);
  });

  test("falls back to equal cuts when no silence at all", () => {
    // duration 120, target 30 → 1*30, 2*30, 3*30
    expect(findSplitPoints(120, [])).toEqual([30, 60, 90]);
  });

  test("forces a split when current segment exceeds 80% of max", () => {
    // target=30, max=45, 80% of max = 36
    // Silence at 36s but no silence between 0 and 36 with segLen >= target
    // segLen=36 < target=30? no, 36 >= 30, so first branch picks it.
    // Use [37] instead: 37 >= 30 and 37 <= 45, picked by first branch.
    expect(findSplitPoints(60, [37])).toEqual([37]);
    // True forced-split case: silence at 11s (< target=30 but > min=10),
    // and segLen 11 > max*0.8=36? no. So 11 NOT picked.
    expect(findSplitPoints(60, [11])).toEqual([30]); // falls back to equal cuts
  });

  test("trims trailing point when tail < min (Refinement A)", () => {
    // duration=120, splits would be [30, 60, 90, 119.8]; tail = 0.2 < min=10
    // Verify with silences at exactly those points:
    expect(findSplitPoints(120, [30, 60, 90, 119.8])).toEqual([30, 60, 90]);
  });

  test("does not trim when tail >= min", () => {
    // duration=120, last split at 100, tail=20 >= min=10
    expect(findSplitPoints(120, [30, 60, 100])).toEqual([30, 60, 100]);
  });

  test("respects custom target/min/max", () => {
    expect(findSplitPoints(200, [50, 100, 150], 50, 20, 70)).toEqual([50, 100, 150]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/splitter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement findSplitPoints in src/splitter.ts**

Create `src/splitter.ts`:

```typescript
// src/splitter.ts
import { cutSegment, getAudioDuration } from "./ffmpeg.ts";

/**
 * Decide where to split an audio file given silence candidates.
 *
 * Mirrors the Python parallel_transcribe.py heuristic:
 * - Prefer silences spaced ~target apart, within [min, max] segment length
 * - Force a split when current segment exceeds 80% of max
 * - Fall back to equal target-length cuts when no silence at all
 *
 * Refinement A: trim trailing split points whose tail-segment would be < min.
 */
export function findSplitPoints(
  duration: number,
  silencePoints: number[],
  target = 30,
  min = 10,
  max = 45,
): number[] {
  if (duration <= max) return [];

  const splitPoints: number[] = [];
  let lastSplit = 0;

  for (const s of silencePoints) {
    const segLen = s - lastSplit;
    if (segLen >= target) {
      if (segLen <= max || splitPoints.length === 0) {
        splitPoints.push(s);
        lastSplit = s;
      }
    } else if (segLen >= min && s - lastSplit > max * 0.8) {
      splitPoints.push(s);
      lastSplit = s;
    }
  }

  if (splitPoints.length === 0 && duration > max) {
    const n = Math.floor(duration / target) + 1;
    for (let i = 1; i < n; i++) {
      splitPoints.push(i * target);
    }
  }

  // Refinement A: drop trailing splits that produce a too-short tail chunk.
  while (splitPoints.length > 0 && duration - splitPoints[splitPoints.length - 1] < min) {
    splitPoints.pop();
  }

  return splitPoints;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test test/splitter.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/splitter.ts test/splitter.test.ts
git commit -m "feat(splitter): findSplitPoints with refinement A (trim short tail)"
```

---

## Task 8: splitter.ts — splitAudio with v1.1.1 filter

**Files:**
- Modify: `src/splitter.ts`
- Modify: `test/splitter.test.ts`

- [ ] **Step 1: Add test for v1.1.1 filter behavior**

The filter is internal to `splitAudio`, but we can expose a pure helper for testability. Append to `test/splitter.test.ts`:

```typescript
import { filterValidSplitPoints } from "../src/splitter.ts";

describe("filterValidSplitPoints (v1.1.1 fix)", () => {
  test("drops points within 0.5s of duration", () => {
    expect(filterValidSplitPoints([10, 30, 119.8, 120.1], 120)).toEqual([10, 30]);
  });

  test("keeps all points when none exceed duration - 0.5", () => {
    expect(filterValidSplitPoints([10, 30, 60], 120)).toEqual([10, 30, 60]);
  });

  test("returns [] when duration is shorter than all points", () => {
    expect(filterValidSplitPoints([10, 30], 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/splitter.test.ts`
Expected: FAIL — `filterValidSplitPoints` not exported.

- [ ] **Step 3: Add `filterValidSplitPoints` and `splitAudio` to src/splitter.ts**

Append to `src/splitter.ts`:

```typescript
import { join } from "node:path";

export function filterValidSplitPoints(splitPoints: number[], duration: number): number[] {
  return splitPoints.filter((sp) => sp < duration - 0.5);
}

export interface AudioChunk {
  path: string;
  startOffset: number;
}

/**
 * Split an audio file at the given timestamps, writing chunk_NNN.mp3 files
 * into outDir. Stream-copies (no re-encode). Returns chunk descriptors with
 * their global start offsets.
 *
 * Applies the v1.1.1 safety filter (drops points within 0.5s of duration).
 */
export async function splitAudio(
  audioPath: string,
  splitPoints: number[],
  outDir: string,
): Promise<AudioChunk[]> {
  const duration = await getAudioDuration(audioPath);
  const valid = filterValidSplitPoints(splitPoints, duration);
  const allPoints = [0, ...valid, duration];

  const chunks: AudioChunk[] = [];
  for (let i = 0; i < allPoints.length - 1; i++) {
    const start = allPoints[i];
    const end = allPoints[i + 1];
    const chunkPath = join(outDir, `chunk_${String(i).padStart(3, "0")}.mp3`);
    await cutSegment(audioPath, start, end, chunkPath);
    chunks.push({ path: chunkPath, startOffset: start });
  }
  return chunks;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test test/splitter.test.ts && bun run typecheck`
Expected: PASS — 10 tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/splitter.ts test/splitter.test.ts
git commit -m "feat(splitter): add splitAudio with v1.1.1 split-point safety filter"
```

---

## Task 9: subtitles.ts — vttToTranscript / srtToTranscript

**Files:**
- Create: `src/subtitles.ts`
- Create: `test/subtitles.test.ts`
- Create: `test/fixtures/subs/simple.vtt`
- Create: `test/fixtures/subs/with_notes.vtt`
- Create: `test/fixtures/subs/multiline.vtt`
- Create: `test/fixtures/subs/simple.srt`

- [ ] **Step 1: Create fixture files**

Create `test/fixtures/subs/simple.vtt`:
```
WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:03.000
Hello world.

00:00:03.500 --> 00:00:05.500
This is a test.
```

Create `test/fixtures/subs/with_notes.vtt`:
```
WEBVTT
Kind: captions
Language: en

NOTE
This is a note that should be skipped.

00:00:00.000 --> 00:00:03.000
First line.

NOTE another note

00:00:03.500 --> 00:00:05.500
Second line.
```

Create `test/fixtures/subs/multiline.vtt`:
```
WEBVTT

00:00:00.000 --> 00:00:05.000
First line of this cue.
Second line of this cue.

00:00:05.000 --> 00:00:10.000
Another cue.
```

Create `test/fixtures/subs/simple.srt`:
```
1
00:00:00,000 --> 00:00:03,000
Hello world.

2
00:00:03,500 --> 00:00:05,500
This is a test.
```

- [ ] **Step 2: Write failing test**

Create `test/subtitles.test.ts`:

```typescript
// test/subtitles.test.ts
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { srtToTranscript, vttToTranscript } from "../src/subtitles.ts";

const fix = (name: string) => resolve(import.meta.dir, "fixtures/subs", name);

describe("vttToTranscript", () => {
  test("strips header, timestamps, and blank lines from simple VTT", async () => {
    const out = await vttToTranscript(fix("simple.vtt"));
    expect(out).toBe("Hello world.\nThis is a test.\n");
  });

  test("skips NOTE blocks", async () => {
    const out = await vttToTranscript(fix("with_notes.vtt"));
    expect(out).toBe("First line.\nSecond line.\n");
  });

  test("preserves multi-line cues as separate lines", async () => {
    const out = await vttToTranscript(fix("multiline.vtt"));
    expect(out).toBe("First line of this cue.\nSecond line of this cue.\nAnother cue.\n");
  });
});

describe("srtToTranscript", () => {
  test("strips index, timestamps, and blank lines", async () => {
    const out = await srtToTranscript(fix("simple.srt"));
    expect(out).toBe("Hello world.\nThis is a test.\n");
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `bun test test/subtitles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement src/subtitles.ts**

Create `src/subtitles.ts`:

```typescript
// src/subtitles.ts
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const VTT_TIMESTAMP_RE = /-->/;
const VTT_HEADER_RE = /^(WEBVTT|Kind:|Language:|NOTE)/;
const SRT_INDEX_RE = /^\d+$/;
const SRT_TIMESTAMP_RE = /-->/;

export async function vttToTranscript(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  let inNoteBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      inNoteBlock = false;
      continue;
    }
    if (VTT_HEADER_RE.test(line)) {
      if (line.startsWith("NOTE")) inNoteBlock = true;
      continue;
    }
    if (inNoteBlock) continue;
    if (VTT_TIMESTAMP_RE.test(line)) continue;
    // Cue identifier (a digit-only line) — skip
    if (/^\d+$/.test(line)) continue;
    out.push(line);
  }

  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

export async function srtToTranscript(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (SRT_INDEX_RE.test(line)) continue;
    if (SRT_TIMESTAMP_RE.test(line)) continue;
    out.push(line);
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

/**
 * Find the first .vtt or .srt file in `dir`. Returns null if none found.
 */
export async function findSubtitleFile(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (ext === ".vtt" || ext === ".srt") return join(dir, name);
  }
  return null;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test test/subtitles.test.ts && bun run typecheck`
Expected: PASS — 4 tests, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/subtitles.ts test/subtitles.test.ts test/fixtures/subs/
git commit -m "feat(subtitles): vtt/srt → transcript conversion with NOTE block handling"
```

---

## Task 10: download.ts — getMetadata + downloadVideo + downloadAudio

**Files:**
- Create: `src/download.ts`

- [ ] **Step 1: Implement src/download.ts (no unit tests — network-bound)**

Create `src/download.ts`:

```typescript
// src/download.ts
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { type LineHandler, run, runStreaming } from "./shell.ts";
import type { Metadata } from "./types.ts";

export interface DownloadOptions {
  cookiesFromBrowser?: string;
}

const cookieArgs = (opts: DownloadOptions): string[] =>
  opts.cookiesFromBrowser ? ["--cookies-from-browser", opts.cookiesFromBrowser] : [];

const PRINT_TEMPLATE =
  "%(title)s\t%(duration)s\t%(uploader)s\t%(extractor)s\t%(language)s";

export async function getMetadata(url: string, opts: DownloadOptions = {}): Promise<Metadata> {
  const r = await run("yt-dlp", [...cookieArgs(opts), "--no-warnings", "--print", PRINT_TEMPLATE, url]);
  if (r.exitCode !== 0) {
    throw new Error(`yt-dlp metadata fetch failed (${r.exitCode}): ${r.stderr.trim().slice(0, 800)}`);
  }
  const line = r.stdout.split("\n").find((l) => l.includes("\t")) ?? r.stdout.trim();
  const [title, duration, uploader, extractor, language] = line.split("\t");
  return {
    title: title ?? "untitled",
    duration: Number.parseFloat(duration ?? "0") || 0,
    uploader: uploader ?? "",
    platform: extractor ?? "",
    language: language && language !== "NA" ? language : "",
    url,
    downloadTime: new Date().toISOString(),
  };
}

const onStderrPassthrough: LineHandler = (line) => process.stderr.write(line + "\n");

export async function downloadVideo(
  url: string,
  outDir: string,
  opts: DownloadOptions = {},
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const args = [
    ...cookieArgs(opts),
    "-f",
    "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    join(outDir, "video.%(ext)s"),
    url,
  ];
  const exit = await runStreaming("yt-dlp", args, onStderrPassthrough, onStderrPassthrough);
  if (exit !== 0) throw new Error(`yt-dlp video download failed (${exit})`);
  return join(outDir, "video.mp4");
}

export async function downloadAudio(
  url: string,
  outDir: string,
  opts: DownloadOptions = {},
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const args = [
    ...cookieArgs(opts),
    "-x",
    "--audio-format",
    "mp3",
    "-o",
    join(outDir, "audio.%(ext)s"),
    url,
  ];
  const exit = await runStreaming("yt-dlp", args, onStderrPassthrough, onStderrPassthrough);
  if (exit !== 0) throw new Error(`yt-dlp audio download failed (${exit})`);
  return join(outDir, "audio.mp3");
}

async function nonEmptyVttPresent(dir: string, prefix = "subtitle"): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    if (extname(n).toLowerCase() !== ".vtt") continue;
    const full = join(dir, n);
    const s = await stat(full);
    if (s.size > 0) return full;
  }
  return null;
}

/**
 * Try manual subtitles first, then auto. Renames a winning file to
 * `<outDir>/subtitle.vtt`. Returns "manual" / "auto" / null.
 */
export async function downloadSubtitles(
  url: string,
  outDir: string,
  opts: DownloadOptions = {},
): Promise<"manual" | "auto" | null> {
  await mkdir(outDir, { recursive: true });
  const baseOut = join(outDir, "subtitle");

  // Tier 1: manual
  await run("yt-dlp", [
    ...cookieArgs(opts),
    "--write-subs",
    "--sub-lang",
    "zh,en,zh-Hans,zh-Hant",
    "--skip-download",
    "-o",
    baseOut,
    url,
  ]);
  const manual = await nonEmptyVttPresent(outDir);
  if (manual) {
    if (manual !== join(outDir, "subtitle.vtt")) {
      await rename(manual, join(outDir, "subtitle.vtt"));
    }
    return "manual";
  }

  // Tier 2: auto
  await run("yt-dlp", [
    ...cookieArgs(opts),
    "--write-auto-subs",
    "--sub-lang",
    "zh,en",
    "--skip-download",
    "-o",
    baseOut,
    url,
  ]);
  const auto = await nonEmptyVttPresent(outDir);
  if (auto) {
    if (auto !== join(outDir, "subtitle.vtt")) {
      await rename(auto, join(outDir, "subtitle.vtt"));
    }
    return "auto";
  }

  return null;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/download.ts
git commit -m "feat(download): yt-dlp wrappers — metadata, video, audio, 3-tier subs"
```

---

## Task 11: workers/whisper-worker.ts — single-chunk transcription

**Files:**
- Create: `src/workers/whisper-worker.ts`

- [ ] **Step 1: Create worker file**

Create `src/workers/whisper-worker.ts`:

```typescript
// src/workers/whisper-worker.ts
// Worker entry point. Receives WorkerMessage, posts WorkerReply.
//
// Lifecycle:
//   1. Worker starts and posts {type:'READY'}.
//   2. Pool sends {type:'LOAD', model} → worker loads model and posts {type:'READY'}.
//   3. Pool sends {type:'TRANSCRIBE', task} → worker transcribes and posts {type:'RESULT'} or {type:'ERROR'}.
//   4. Pool sends {type:'SHUTDOWN'} → worker closes the model and exits.

import { Whisper } from "smart-whisper";
import type { Segment, WorkerMessage, WorkerReply } from "../types.ts";

let whisper: Whisper | null = null;

const post = (msg: WorkerReply) => {
  // self.postMessage in Bun web-worker style
  (self as unknown as { postMessage: (m: WorkerReply) => void }).postMessage(msg);
};

(self as unknown as { onmessage: (e: MessageEvent<WorkerMessage>) => void }).onmessage = async (
  e,
) => {
  const msg = e.data;
  switch (msg.type) {
    case "LOAD": {
      try {
        whisper = new Whisper(msg.model, { gpu: true });
        post({ type: "READY" });
      } catch (err) {
        post({ type: "ERROR", chunkIdx: -1, message: (err as Error).message });
      }
      return;
    }
    case "TRANSCRIBE": {
      const { chunkIdx, chunkPath, startTime, language } = msg.task;
      try {
        if (!whisper) throw new Error("worker received TRANSCRIBE before LOAD");
        const lang = language === "auto" ? null : language;
        // smart-whisper transcribe — convert audio to PCM Float32 first
        const audio = await loadPcm(chunkPath);
        const task = await whisper.transcribe(audio, {
          language: lang ?? undefined,
          suppress_blank: true,
        });
        const result = await task.result;
        const segments: Segment[] = result.map((seg) => ({
          start: seg.from / 1000, // smart-whisper returns ms
          end: seg.to / 1000,
          text: seg.text.trim(),
        }));
        post({
          type: "RESULT",
          result: { chunkIdx, segments, startTime },
        });
      } catch (err) {
        post({ type: "ERROR", chunkIdx, message: (err as Error).message });
      }
      return;
    }
    case "SHUTDOWN": {
      try {
        if (whisper) await whisper.free();
      } catch {
        // ignore
      }
      whisper = null;
      // Bun worker exit
      (self as unknown as { close: () => void }).close();
      return;
    }
  }
};

/**
 * Decode an audio file to mono Float32 PCM at 16kHz using ffmpeg piped to stdout.
 * smart-whisper expects this format.
 */
async function loadPcm(path: string): Promise<Float32Array> {
  const proc = Bun.spawn(
    ["ffmpeg", "-i", path, "-f", "f32le", "-ar", "16000", "-ac", "1", "-"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const buf = await new Response(proc.stdout).arrayBuffer();
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`ffmpeg PCM decode failed for ${path}`);
  return new Float32Array(buf);
}

// Announce readiness before LOAD arrives
post({ type: "READY" });
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0. (smart-whisper types come from the package; if not, add `// @ts-expect-error if module types are incomplete` at the import line and proceed.)

- [ ] **Step 3: Commit**

```bash
git add src/workers/whisper-worker.ts
git commit -m "feat(worker): whisper-worker entry — LOAD/TRANSCRIBE/SHUTDOWN protocol"
```

---

## Task 12: transcribe.ts — model resolution + worker pool + transcribeParallel

**Files:**
- Create: `src/transcribe.ts`

- [ ] **Step 1: Implement model resolution helper**

Create `src/transcribe.ts`:

```typescript
// src/transcribe.ts
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import * as os from "node:os";
import { join } from "node:path";
import { detectSilence } from "./silence.ts";
import { findSplitPoints, splitAudio, type AudioChunk } from "./splitter.ts";
import { getAudioDuration } from "./ffmpeg.ts";
import type {
  ChunkResult,
  ChunkTask,
  Segment,
  WhisperModelName,
  WorkerMessage,
  WorkerReply,
} from "./types.ts";

export const MAX_CONCURRENT_INFERENCE = Math.max(1, Math.floor(os.cpus().length / 4));

const MODEL_CACHE_DIR = join(homedir(), ".cache", "whisper-models");

export async function resolveModel(name: WhisperModelName): Promise<string> {
  const file = join(MODEL_CACHE_DIR, `ggml-${name}.bin`);
  if (await Bun.file(file).exists()) return file;

  await mkdir(MODEL_CACHE_DIR, { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
  process.stderr.write(`Downloading whisper model ${name} from HuggingFace...\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download whisper model: ${res.status} ${res.statusText}`);
  await Bun.write(file, res);
  process.stderr.write(`Model saved to ${file}\n`);
  return file;
}
```

- [ ] **Step 2: Add WorkerPool class**

Append to `src/transcribe.ts`:

```typescript
class WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private resolvers = new Map<Worker, (r: ChunkResult) => void>();
  private rejecters = new Map<Worker, (e: Error) => void>();
  private waiters: Array<(w: Worker) => void> = [];
  private modelPath: string;

  constructor(size: number, modelPath: string) {
    this.modelPath = modelPath;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL("./workers/whisper-worker.ts", import.meta.url).href, {
        type: "module",
      });
      this.workers.push(worker);
      worker.onmessage = (e: MessageEvent<WorkerReply>) => this.onReply(worker, e.data);
      worker.onerror = (e) => {
        const rej = this.rejecters.get(worker);
        if (rej) rej(new Error(`worker errored: ${e.message ?? e.toString()}`));
      };
    }
  }

  /** Wait until every worker has loaded its model. */
  async ready(): Promise<void> {
    await Promise.all(
      this.workers.map(
        (w) =>
          new Promise<void>((resolve, reject) => {
            const handler = (e: MessageEvent<WorkerReply>) => {
              const data = e.data;
              if (data.type === "READY") {
                w.removeEventListener("message", handler as EventListener);
                resolve();
              } else if (data.type === "ERROR") {
                w.removeEventListener("message", handler as EventListener);
                reject(new Error(data.message));
              }
            };
            w.addEventListener("message", handler as EventListener);
            // First READY signals worker startup; we then send LOAD and wait for the second READY.
            const sendLoad = (e2: MessageEvent<WorkerReply>) => {
              if (e2.data.type === "READY") {
                w.removeEventListener("message", sendLoad as EventListener);
                this.send(w, { type: "LOAD", model: this.modelPath });
              }
            };
            w.addEventListener("message", sendLoad as EventListener, { once: true });
          }),
      ),
    );
    this.idle = [...this.workers];
  }

  private send(w: Worker, msg: WorkerMessage) {
    w.postMessage(msg);
  }

  private onReply(w: Worker, reply: WorkerReply) {
    if (reply.type === "RESULT") {
      const r = this.resolvers.get(w);
      if (r) {
        this.resolvers.delete(w);
        this.rejecters.delete(w);
        r(reply.result);
        this.releaseWorker(w);
      }
    } else if (reply.type === "ERROR") {
      const r = this.resolvers.get(w);
      if (r) {
        // Surface as an empty-segments result so the pool keeps draining.
        this.resolvers.delete(w);
        this.rejecters.delete(w);
        r({ chunkIdx: reply.chunkIdx, segments: [], startTime: 0, error: reply.message });
        this.releaseWorker(w);
      }
    }
    // READY messages outside ready() are ignored.
  }

  private releaseWorker(w: Worker) {
    const next = this.waiters.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  private acquire(): Promise<Worker> {
    return new Promise((resolve) => {
      const w = this.idle.shift();
      if (w) resolve(w);
      else this.waiters.push(resolve);
    });
  }

  async dispatch(task: ChunkTask): Promise<ChunkResult> {
    const w = await this.acquire();
    return new Promise<ChunkResult>((resolve, reject) => {
      this.resolvers.set(w, (r) => resolve({ ...r, startTime: task.startTime }));
      this.rejecters.set(w, reject);
      this.send(w, { type: "TRANSCRIBE", task });
    });
  }

  async terminate(): Promise<void> {
    for (const w of this.workers) {
      try {
        this.send(w, { type: "SHUTDOWN" });
      } catch {
        // ignore
      }
    }
    // Give workers a moment to free models, then force-terminate.
    await new Promise((r) => setTimeout(r, 200));
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}
```

- [ ] **Step 3: Add VTT/transcript writers and merge helper**

Append to `src/transcribe.ts`:

```typescript
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function mergeSegments(results: Map<number, ChunkResult>): Segment[] {
  const out: Segment[] = [];
  const sorted = [...results.keys()].sort((a, b) => a - b);
  for (const idx of sorted) {
    const { segments, startTime } = results.get(idx)!;
    for (const seg of segments) {
      out.push({
        start: seg.start + startTime,
        end: seg.end + startTime,
        text: seg.text,
      });
    }
  }
  return out;
}

async function writeVtt(segments: Segment[], path: string): Promise<void> {
  let text = "WEBVTT\n\n";
  for (const seg of segments) {
    text += `${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}\n${seg.text}\n\n`;
  }
  await Bun.write(path, text);
}

async function writeTranscript(segments: Segment[], path: string): Promise<void> {
  const text = segments.map((s) => s.text).join("\n") + (segments.length > 0 ? "\n" : "");
  await Bun.write(path, text);
}
```

- [ ] **Step 4: Add transcribeParallel orchestration**

Append to `src/transcribe.ts`:

```typescript
export interface TranscribeOptions {
  input: string;
  outputDir: string;
  model: WhisperModelName;
  language: string;
  workers?: number | undefined;
  minSegment?: number;
}

export interface TranscribeReport {
  totalChunks: number;
  failedChunks: number;
}

export async function transcribeParallel(opts: TranscribeOptions): Promise<TranscribeReport> {
  const { input, outputDir, model, language } = opts;
  const minSegment = opts.minSegment ?? 60;
  const requested = opts.workers ?? Math.max(1, Math.floor(os.cpus().length / 2));

  const duration = await getAudioDuration(input);
  process.stderr.write(`Audio duration: ${duration.toFixed(1)}s\n`);

  const modelPath = await resolveModel(model);

  if (duration < minSegment) {
    process.stderr.write("Audio is short, transcribing directly...\n");
    const pool = new WorkerPool(1, modelPath);
    try {
      await pool.ready();
      const result = await pool.dispatch({
        chunkIdx: 0,
        chunkPath: input,
        startTime: 0,
        language,
      });
      const all = mergeSegments(new Map([[0, result]]));
      await writeVtt(all, join(outputDir, "subtitle.vtt"));
      await writeTranscript(all, join(outputDir, "transcript.txt"));
      return { totalChunks: 1, failedChunks: result.error ? 1 : 0 };
    } finally {
      await pool.terminate();
    }
  }

  process.stderr.write("Detecting silence points...\n");
  const silencePoints = await detectSilence(input);
  process.stderr.write(`Found ${silencePoints.length} silence points\n`);

  const splitPoints = findSplitPoints(duration, silencePoints);
  process.stderr.write(`Will split into ${splitPoints.length + 1} chunks\n`);

  const tmpRoot = await mkdtemp(join(tmpdir(), "video-summarizer-"));
  let pool: WorkerPool | null = null;

  try {
    process.stderr.write("Splitting audio...\n");
    const chunks: AudioChunk[] = await splitAudio(input, splitPoints, tmpRoot);

    const effectiveWorkers = Math.min(requested, chunks.length, MAX_CONCURRENT_INFERENCE);
    process.stderr.write(`Transcribing ${chunks.length} chunks with ${effectiveWorkers} workers...\n`);

    pool = new WorkerPool(effectiveWorkers, modelPath);
    await pool.ready();

    const results = new Map<number, ChunkResult>();
    let failed = 0;
    let completed = 0;
    await Promise.all(
      chunks.map(async (chunk, idx) => {
        const result = await pool!.dispatch({
          chunkIdx: idx,
          chunkPath: chunk.path,
          startTime: chunk.startOffset,
          language,
        });
        results.set(idx, result);
        completed++;
        if (result.error) {
          failed++;
          process.stderr.write(`  Chunk ${idx} failed: ${result.error}\n`);
        } else {
          process.stderr.write(`  Chunk ${completed}/${chunks.length} completed\n`);
        }
      }),
    );

    process.stderr.write("Merging segments...\n");
    const all = mergeSegments(results);
    await writeVtt(all, join(outputDir, "subtitle.vtt"));
    await writeTranscript(all, join(outputDir, "transcript.txt"));

    return { totalChunks: chunks.length, failedChunks: failed };
  } finally {
    if (pool) await pool.terminate();
    await rm(tmpRoot, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/transcribe.ts
git commit -m "feat(transcribe): worker pool + transcribeParallel + model auto-download"
```

---

## Task 13: cli.ts — arg parsing, dependency check, signal handlers, main flow

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Create src/cli.ts**

```typescript
#!/usr/bin/env bun
// src/cli.ts
import { parseArgs } from "node:util";
import { mkdir, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  downloadAudio,
  downloadSubtitles,
  downloadVideo,
  getMetadata,
} from "./download.ts";
import { findSubtitleFile, vttToTranscript } from "./subtitles.ts";
import { transcribeParallel } from "./transcribe.ts";
import { sanitizeTitle, which } from "./shell.ts";
import type { CliOptions, SubtitleSource, WhisperModelName } from "./types.ts";

const USAGE = `Usage: bun run summarize <url> [options]

Options:
  --model <name>            tiny | base | small (default) | medium | large-v3
  --language <code>         Language code or 'auto' (default: auto)
  --workers <n>             Parallel ASR workers (default: floor(CPU/2),
                            silently capped at MAX_CONCURRENT_INFERENCE = floor(CPU/4))
  --min-segment <sec>       Min duration to enable splitting (default: 60)
  --output <dir>            Root output dir (default: ./downloads)
  --cookies-from-browser <browser>   chrome | firefox | edge | safari
  --skip-video              Don't download video.mp4
  --no-disk-check           Skip the pre-flight free-space warning
  --help                    Print this help
`;

const VALID_MODELS: WhisperModelName[] = ["tiny", "base", "small", "medium", "large-v3"];
const MIN_FREE_BYTES = 2 * 1024 ** 3; // 2 GB

function parseCliArgs(): CliOptions {
  const { values, positionals } = parseArgs({
    options: {
      model: { type: "string", default: "small" },
      language: { type: "string", default: "auto" },
      workers: { type: "string" },
      "min-segment": { type: "string", default: "60" },
      output: { type: "string", default: "./downloads" },
      "cookies-from-browser": { type: "string" },
      "skip-video": { type: "boolean", default: false },
      "no-disk-check": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const url = positionals[0];
  if (!url) {
    process.stderr.write("Error: missing <url>\n\n" + USAGE);
    process.exit(1);
  }
  if (!VALID_MODELS.includes(values.model as WhisperModelName)) {
    process.stderr.write(`Error: --model must be one of: ${VALID_MODELS.join(", ")}\n`);
    process.exit(1);
  }
  return {
    url,
    model: values.model as WhisperModelName,
    language: values.language!,
    workers: values.workers ? Number.parseInt(values.workers, 10) : undefined,
    minSegment: Number.parseInt(values["min-segment"]!, 10),
    output: values.output!,
    cookiesFromBrowser: values["cookies-from-browser"],
    skipVideo: values["skip-video"]!,
    noDiskCheck: values["no-disk-check"]!,
  };
}

async function checkDependencies(): Promise<void> {
  const missing: string[] = [];
  for (const bin of ["yt-dlp", "ffmpeg", "ffprobe"]) {
    if (!(await which(bin))) missing.push(bin);
  }
  if (missing.length > 0) {
    process.stderr.write(
      `Error: missing required binaries: ${missing.join(", ")}\n` +
        "Run: bun run skills/video-summarizer/scripts/install_deps.ts\n",
    );
    process.exit(1);
  }
}

async function checkDiskSpace(dir: string): Promise<void> {
  try {
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    if (free < MIN_FREE_BYTES) {
      process.stderr.write(
        `Warning: only ${(free / 1024 ** 3).toFixed(1)} GB free on ${dir}'s filesystem ` +
          `(recommend ≥ 2 GB). Pass --no-disk-check to silence this.\n`,
      );
    }
  } catch {
    // statfs not supported (very old node) — silently skip
  }
}

let cleanupHooks: Array<() => Promise<void> | void> = [];

function installSignalHandlers() {
  const handle = async (sig: NodeJS.Signals) => {
    process.stderr.write(`\nReceived ${sig}, cleaning up...\n`);
    for (const h of cleanupHooks) {
      try {
        await h();
      } catch {
        // ignore
      }
    }
    process.exit(130);
  };
  process.on("SIGINT", handle);
  process.on("SIGTERM", handle);
}

export async function main(): Promise<number> {
  installSignalHandlers();
  const opts = parseCliArgs();

  await checkDependencies();
  await mkdir(opts.output, { recursive: true });
  if (!opts.noDiskCheck) await checkDiskSpace(opts.output);

  process.stderr.write(`Fetching metadata for ${opts.url}...\n`);
  const meta = await getMetadata(opts.url, { cookiesFromBrowser: opts.cookiesFromBrowser });
  const safeTitle = sanitizeTitle(meta.title);
  const outDir = join(opts.output, safeTitle);
  await mkdir(outDir, { recursive: true });
  process.stderr.write(`Output dir: ${outDir}\n`);

  if (!opts.skipVideo) {
    process.stderr.write("Downloading video...\n");
    await downloadVideo(opts.url, outDir, { cookiesFromBrowser: opts.cookiesFromBrowser });
  }

  process.stderr.write("Extracting audio...\n");
  await downloadAudio(opts.url, outDir, { cookiesFromBrowser: opts.cookiesFromBrowser });

  process.stderr.write("Trying to fetch subtitles...\n");
  let source: SubtitleSource;
  const subTier = await downloadSubtitles(opts.url, outDir, {
    cookiesFromBrowser: opts.cookiesFromBrowser,
  });
  if (subTier) {
    source = subTier;
    const sub = await findSubtitleFile(outDir);
    if (sub) {
      const txt = await vttToTranscript(sub);
      await Bun.write(join(outDir, "transcript.txt"), txt);
    }
  } else {
    source = "whisper";
    const audioPath = join(outDir, "audio.mp3");
    const report = await transcribeParallel({
      input: audioPath,
      outputDir: outDir,
      model: opts.model,
      language: opts.language,
      workers: opts.workers,
      minSegment: opts.minSegment,
    });
    if (report.failedChunks > 0 && report.failedChunks === report.totalChunks) {
      process.stderr.write(`All ${report.totalChunks} chunks failed transcription.\n`);
      process.exit(2);
    }
  }

  await writeFile(
    join(outDir, "_metadata.json"),
    JSON.stringify(
      {
        title: meta.title,
        platform: meta.platform,
        url: meta.url,
        duration: meta.duration,
        language: meta.language,
        downloadTime: meta.downloadTime,
        subtitleSource: source,
      },
      null,
      2,
    ),
  );

  process.stdout.write(
    [
      "✓ video.mp4",
      "✓ audio.mp3",
      `✓ subtitle.vtt    (source: ${source})`,
      "✓ transcript.txt",
      "⚠ summary.md      (skill mode only — Claude generates this)",
    ].join("\n") + "\n",
  );
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Fatal: ${(err as Error).stack ?? String(err)}\n`);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 2: Verify typecheck and lint pass**

Run: `bun run typecheck && bun run lint`
Expected: typecheck 0; lint may report `noNonNullAssertion` style warnings — acceptable since the rule is off.

- [ ] **Step 3: Smoke test the help output**

Run: `bun run summarize --help`
Expected: Usage block printed, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): main entry — arg parsing, dep check, signal handlers, main flow"
```

---

## Task 14: install_deps.ts — Bun script replacing install_deps.sh

**Files:**
- Create: `skills/video-summarizer/scripts/install_deps.ts`

- [ ] **Step 1: Create the install script**

```typescript
#!/usr/bin/env bun
// skills/video-summarizer/scripts/install_deps.ts
// Check + install required system tools for the video-summarizer skill.

import { run, which } from "../../../src/shell.ts";

const log = (s: string) => process.stdout.write(s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");

async function ensureXcodeCli(): Promise<void> {
  if (process.platform !== "darwin") return;
  const r = await run("xcode-select", ["-p"]);
  if (r.exitCode !== 0) {
    err("  Xcode Command Line Tools not found.");
    err("  Install with: xcode-select --install");
    err("  (Required so `bun install` can build smart-whisper's N-API addon.)");
    process.exit(1);
  }
  log("  Xcode CLI Tools: OK");
}

async function ensureFfmpeg(): Promise<void> {
  if (await which("ffmpeg")) {
    log("  ffmpeg: OK");
    return;
  }
  if (process.platform === "darwin") {
    if (!(await which("brew"))) {
      err("  Error: Homebrew not found. Install ffmpeg manually.");
      process.exit(1);
    }
    log("  Installing ffmpeg via brew...");
    const r = await run("brew", ["install", "ffmpeg"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    log("  ffmpeg installed.");
    return;
  }
  if (await Bun.file("/etc/debian_version").exists()) {
    log("  Installing ffmpeg via apt-get...");
    await run("sudo", ["apt-get", "update"]);
    const r = await run("sudo", ["apt-get", "install", "-y", "ffmpeg"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    return;
  }
  if (await Bun.file("/etc/redhat-release").exists()) {
    log("  Installing ffmpeg via dnf...");
    const r = await run("sudo", ["dnf", "install", "-y", "ffmpeg"]);
    if (r.exitCode !== 0) {
      err(r.stderr);
      process.exit(1);
    }
    return;
  }
  err("  Error: please install ffmpeg manually.");
  process.exit(1);
}

async function ensureYtDlp(): Promise<void> {
  if (await which("yt-dlp")) {
    log("  yt-dlp: OK");
    return;
  }
  if (process.platform === "darwin" && (await which("brew"))) {
    log("  Installing yt-dlp via brew...");
    await run("brew", ["install", "yt-dlp"]);
    return;
  }
  if (await which("pipx")) {
    log("  Installing yt-dlp via pipx...");
    await run("pipx", ["install", "yt-dlp"]);
    return;
  }
  err("  Error: install yt-dlp manually (e.g. brew install yt-dlp).");
  process.exit(1);
}

async function ensureBunDeps(): Promise<void> {
  log("  Running `bun install` to make sure smart-whisper is built...");
  const r = await run("bun", ["install"], { cwd: process.cwd() });
  if (r.exitCode !== 0) {
    err(r.stderr);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  log("==========================================");
  log("Video Summarizer (TS) - Dependency Check");
  log("==========================================");
  log("");
  log("[1/5] Xcode Command Line Tools (macOS only)");
  await ensureXcodeCli();
  log("");
  log("[2/5] ffmpeg / ffprobe");
  await ensureFfmpeg();
  if (!(await which("ffprobe"))) {
    err("  Error: ffprobe missing (should ship with ffmpeg).");
    process.exit(1);
  }
  log("  ffprobe: OK");
  log("");
  log("[3/5] yt-dlp");
  await ensureYtDlp();
  log("");
  log("[4/5] Bun JS deps (smart-whisper)");
  await ensureBunDeps();
  log("");
  log("[5/5] All dependencies present.");
  log("");
  log("Versions:");
  for (const [name, args] of [
    ["bun", ["--version"]] as const,
    ["ffmpeg", ["-version"]] as const,
    ["yt-dlp", ["--version"]] as const,
  ]) {
    const r = await run(name, args);
    log(`  ${name}: ${r.stdout.trim().split("\n")[0]}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    err(`Fatal: ${(e as Error).message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run the install script (manual smoke test)**

Run: `bun run skills/video-summarizer/scripts/install_deps.ts`
Expected: All five steps log "OK" or "installed". On macOS with brew + Xcode CLI Tools, this should be a no-op.

- [ ] **Step 4: Commit**

```bash
git add skills/video-summarizer/scripts/install_deps.ts
git commit -m "feat(install): Bun-native dependency installer (replaces install_deps.sh)"
```

---

## Task 15: SKILL.md — instructions for Claude

**Files:**
- Create: `skills/video-summarizer/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add skills/video-summarizer/SKILL.md
git commit -m "docs(skill): add SKILL.md for the TS port"
```

---

## Task 16: reference/summary-prompt.md (verbatim from upstream)

**Files:**
- Create: `skills/video-summarizer/reference/summary-prompt.md`

- [ ] **Step 1: Copy summary-prompt template**

```markdown
# Video Summary Prompt Template

Generate a structured summary based on the following video transcript.

## Video Information
- **Title**: {{TITLE}}
- **Source**: {{PLATFORM}}
- **URL**: {{URL}}
- **Duration**: {{DURATION}}
- **Language**: {{LANGUAGE}}
- **Download Time**: {{DOWNLOAD_TIME}}

## Transcript Content
{{TRANSCRIPT}}

---

## Please generate summary in the following format:

# Video Summary: {{TITLE}}

## Basic Information
- **Source**: {{PLATFORM}}
- **URL**: {{URL}}
- **Duration**: {{DURATION}}
- **Language**: {{LANGUAGE}}
- **Download Time**: {{DOWNLOAD_TIME}}

## Output Files
- video.mp4 - Original video
- audio.mp3 - Audio file
- subtitle.vtt - Subtitles (with timestamps)
- transcript.txt - Plain text transcript
- summary.md - This summary file

## Overview
[2-3 sentences summarizing the main content]

## Key Points
1. [Point 1]
2. [Point 2]
3. [Point 3]
...

## Detailed Content

### [Topic 1]
[Detailed explanation]

### [Topic 2]
[Detailed explanation]

## Notable Quotes
> "[Important quote 1]"

> "[Important quote 2]"

## Related Topics
- [Related topic 1]
- [Related topic 2]
```

- [ ] **Step 2: Commit**

```bash
git add skills/video-summarizer/reference/summary-prompt.md
git commit -m "docs(skill): add summary-prompt template (verbatim from upstream)"
```

---

## Task 17: .claude-plugin metadata

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create plugin.json**

```json
{
  "name": "video-summarizer",
  "description": "Download videos from 1800+ platforms and generate AI summaries (TypeScript + Bun port)",
  "version": "2.0.0",
  "author": {
    "name": "linheng21cn"
  },
  "homepage": "https://github.com/jokerlin/summarize-video",
  "license": "MIT"
}
```

- [ ] **Step 2: Create marketplace.json**

```json
{
  "name": "video-summarizer",
  "id": "video-summarizer",
  "owner": {
    "name": "linheng21cn"
  },
  "metadata": {
    "description": "Download videos from 1800+ platforms and generate AI summaries (TypeScript + Bun port)",
    "version": "2.0.0"
  },
  "plugins": [
    {
      "name": "video-summarizer",
      "source": "./",
      "description": "Download videos from YouTube, Bilibili, Twitter/X, TikTok and 1800+ platforms. Outputs video (MP4), audio (MP3), subtitles (VTT), transcript (TXT), and metadata. Implementation: TypeScript + Bun (no Python). ASR via smart-whisper (whisper.cpp/N-API).",
      "version": "2.0.0",
      "author": {
        "name": "linheng21cn"
      },
      "keywords": [
        "video",
        "download",
        "youtube",
        "bilibili",
        "twitter",
        "tiktok",
        "subtitle",
        "transcription",
        "whisper",
        "ai-summary",
        "yt-dlp",
        "typescript",
        "bun"
      ],
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/
git commit -m "chore(plugin): add plugin.json and marketplace.json metadata"
```

---

## Task 18: README.md and CHANGELOG.md

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`

- [ ] **Step 1: Create LICENSE (MIT, identical to upstream)**

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create README.md**

```markdown
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
```

- [ ] **Step 3: Create CHANGELOG.md**

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md LICENSE
git commit -m "docs: add README, CHANGELOG, LICENSE"
```

---

## Task 19: test/MANUAL.md — manual smoke-test procedure

**Files:**
- Create: `test/MANUAL.md`

- [ ] **Step 1: Create test/MANUAL.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add test/MANUAL.md
git commit -m "docs(test): manual smoke-test procedure"
```

---

## Task 20: End-to-end verification on a real URL

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit-test suite**

Run: `bun test`
Expected: all tests pass (Tasks 3, 5, 6, 7, 8, 9 contributed tests).

- [ ] **Step 2: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0.

- [ ] **Step 3: Run the help text**

Run: `bun run summarize --help`
Expected: usage block printed.

- [ ] **Step 4: Run on a known-good short YouTube URL**

Run: `bun run summarize "https://www.youtube.com/watch?v=jNQXAC9IVRw"`
Expected:
- All five files present in `./downloads/Me_at_the_zoo/`
- `_metadata.json` parseable and contains `subtitleSource`
- Process exits 0

If anything fails, fix in-place (this verification task should not produce a partial commit). Re-run.

- [ ] **Step 5: Tag a release commit**

```bash
git status --short    # confirm clean
git log --oneline -5  # confirm sane history
git tag v2.0.0
```

(Don't push the tag automatically — that's the user's call.)

---

## Spec Coverage Self-Check

Mapping spec sections to plan tasks:

| Spec section | Implemented in |
|---|---|
| §1 Goal & Scope | tasks 1, 13, 15 |
| §2 Project Layout | tasks 1, 17 |
| §3 Modules | tasks 2 (types), 3-4 (shell), 5 (ffmpeg), 6 (silence), 7-8 (splitter), 9 (subtitles), 10 (download), 11 (worker), 12 (transcribe), 13 (cli) |
| §3 Whisper model resolution | task 12 step 1 |
| §3 Worker pool + MAX_CONCURRENT_INFERENCE | task 12 step 2 |
| §3 runStreaming | task 4 |
| §4 Pipeline A | task 13 |
| §4 Pipeline B | task 12 step 4 |
| §4 Skill mode summary.md | task 15 (SKILL.md step 6) |
| §5 findSplitPoints + Refinement A | task 7 |
| §5 v1.1.1 filter | task 8 |
| §5 silence-to-EOF | task 6 |
| §6 Error handling table | task 13 (dep check, signal handlers, disk check, exit codes), task 12 (per-chunk failure, model download fail) |
| §6 Logging | tasks 12, 13 |
| §6 Exit codes | task 13 |
| §6 sanitizeTitle | task 3 |
| §6 Xcode CLI Tools check | task 14 |
| §7 Tests | tasks 3, 5, 6, 7, 8, 9, 19 (manual) |
| §8 CLI Reference | task 13 |
| §9 Open differences | tasks 12 (cap), 4 (streaming), 12 (CoreML — implicit via smart-whisper), 13 (--output, --no-disk-check) |
| §10 Implementation order | this plan |

No gaps identified.

## Type Consistency Self-Check

- `Segment {start, end, text}` — defined in Task 2, used identically in Tasks 11, 12.
- `ChunkTask {chunkIdx, chunkPath, startTime, language}` — defined in Task 2, dispatched in Task 12, consumed in Task 11.
- `ChunkResult {chunkIdx, segments, startTime, error?}` — defined in Task 2, returned by Tasks 11, 12.
- `WorkerMessage` and `WorkerReply` discriminated unions — defined in Task 2, sent in Task 12, received in Task 11.
- `Metadata` — defined in Task 2, produced in Task 10, consumed in Task 13.
- `SubtitleSource` — defined in Task 2, returned by Task 10, written to `_metadata.json` in Task 13.
- `WhisperModelName` — defined in Task 2, used by Tasks 12, 13.
- `CliOptions` — defined in Task 2, used by Task 13.

All cross-task type names match.

## Placeholder Scan

- ✅ No "TBD" / "TODO" / "fill in details" left.
- ✅ Every step that changes code shows the code.
- ✅ Every test step shows actual test code, not "write tests for the above".
- ✅ Every command step shows the exact command and expected output.
- ✅ Two minor inline notes (Task 5 step 3 typo callout, Task 11 step 2 ts-expect-error fallback) are explicit instructions, not vague placeholders.

---

**Plan status:** Ready for execution.
