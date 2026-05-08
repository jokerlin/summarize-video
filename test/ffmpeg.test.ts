// test/ffmpeg.test.ts
import { describe, expect, test } from "bun:test";
import { buildDurationArgs } from "../src/ffmpeg.ts";

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
});
