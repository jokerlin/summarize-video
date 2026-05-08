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
    expect(buildSilenceDetectArgs("/tmp/a.mp3", -30, 0.25)).toContain(
      "silencedetect=noise=-30dB:d=0.25",
    );
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
