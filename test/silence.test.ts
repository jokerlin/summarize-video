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
    expect(parseSilenceDetectStderr(fix("silence_to_eof.txt"), 60)).toEqual([5.5, 58.2]);
  });

  test("ignores trailing silence_start when >= audioDuration", () => {
    expect(parseSilenceDetectStderr(fix("silence_to_eof.txt"), 58)).toEqual([5.5]);
  });

  test("tolerates malformed lines", () => {
    expect(parseSilenceDetectStderr(fix("malformed.txt"), 100)).toEqual([7.5]);
  });
});
