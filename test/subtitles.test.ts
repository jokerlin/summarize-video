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
