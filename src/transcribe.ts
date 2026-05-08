// src/transcribe.ts
// Thin wrapper around the OpenAI `whisper` CLI (Python).
//
// Why CLI instead of an N-API addon (smart-whisper):
//   smart-whisper crashes Bun under macOS Metal during teardown / mid-inference
//   (panic: Bus error). The Python CLI is slower but rock-solid.
//
// Outputs:
//   - <outputDir>/subtitle.vtt   (VTT with timestamps)
//   - <outputDir>/transcript.txt (plain text, no timestamps)

import { rename, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { runStreaming, which } from "./shell.ts";
import { vttToTranscript } from "./subtitles.ts";
import type { WhisperModelName } from "./types.ts";

export interface TranscribeOptions {
  /** Path to the audio file to transcribe (e.g. <outDir>/audio.mp3). */
  input: string;
  /** Where to drop subtitle.vtt and transcript.txt. */
  outputDir: string;
  /** Whisper model name. */
  model: WhisperModelName;
  /** Language code or 'auto' (CLI accepts both — 'auto' => omit --language). */
  language: string;
}

export async function transcribeWithWhisperCli(opts: TranscribeOptions): Promise<void> {
  if (!(await which("whisper"))) {
    throw new Error(
      "`whisper` CLI not found. Install with: pipx install openai-whisper " +
        "(or `pip install -U openai-whisper`).",
    );
  }

  const { input, outputDir, model, language } = opts;
  const args = [
    input,
    "--model",
    model,
    "--output_dir",
    outputDir,
    "--output_format",
    "vtt",
    "--verbose",
    "False",
  ];
  if (language && language !== "auto") {
    args.push("--language", language);
  }

  process.stderr.write(`Running whisper CLI (model=${model}, language=${language})...\n`);
  const onStderr = (line: string) => process.stderr.write(`${line}\n`);
  const exit = await runStreaming("whisper", args, onStderr, onStderr);
  if (exit !== 0) {
    throw new Error(`whisper CLI failed (exit ${exit})`);
  }

  // Whisper names outputs after the input basename: e.g. audio.mp3 -> audio.vtt.
  // Rename to subtitle.vtt for the rest of the pipeline.
  const stem = basename(input, extname(input));
  const generatedVtt = join(outputDir, `${stem}.vtt`);
  const targetVtt = join(outputDir, "subtitle.vtt");
  if (generatedVtt !== targetVtt) {
    // Replace any existing subtitle.vtt (e.g. left from a prior run).
    await rm(targetVtt, { force: true });
    await rename(generatedVtt, targetVtt);
  }

  const transcript = await vttToTranscript(targetVtt);
  await Bun.write(join(outputDir, "transcript.txt"), transcript);
}
