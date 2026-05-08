// src/transcribe.ts
// Wrapper around whisper.cpp's `whisper-cli` binary.
//
// Why whisper.cpp:
//   - Native C++ with Metal GPU acceleration on Apple Silicon (~5–10× faster
//     than openai-whisper Python on the same model).
//   - Stable: no Bun/N-API teardown crashes (the smart-whisper saga).
//   - Accepts mp3 directly (`supported audio formats: flac, mp3, ogg, wav`).
//
// Outputs:
//   - <outputDir>/subtitle.vtt    (whisper-cli writes this with -ovtt)
//   - <outputDir>/transcript.txt  (we strip timestamps from the VTT)

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runStreaming, which } from "./shell.ts";
import { vttToTranscript } from "./subtitles.ts";
import type { WhisperModelName } from "./types.ts";

const MODEL_CACHE_DIR = join(homedir(), ".cache", "whisper-cpp");

export async function resolveModel(name: WhisperModelName): Promise<string> {
  const file = join(MODEL_CACHE_DIR, `ggml-${name}.bin`);
  if (await Bun.file(file).exists()) return file;

  await mkdir(MODEL_CACHE_DIR, { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
  process.stderr.write(`Downloading whisper.cpp model ${name} from HuggingFace...\n`);
  // Shell out to curl: streaming `Bun.write(path, response)` has hung under
  // certain environments (Bun + sandbox). curl is rock-solid and gives us
  // free progress to stderr.
  const exit = await runStreaming(
    "curl",
    ["-fL", "--progress-bar", "-o", file, url],
    (l) => process.stderr.write(`${l}\n`),
    (l) => process.stderr.write(`${l}\n`),
  );
  if (exit !== 0) {
    throw new Error(`curl failed downloading ${url} (exit ${exit})`);
  }
  process.stderr.write(`Model saved to ${file}\n`);
  return file;
}

export interface TranscribeOptions {
  /** Path to the audio file (mp3/wav/flac/ogg accepted by whisper-cli). */
  input: string;
  /** Where to drop subtitle.vtt and transcript.txt. */
  outputDir: string;
  /** Whisper model name (resolved to ggml-<name>.bin). */
  model: WhisperModelName;
  /** Language code (e.g. "zh", "en") or "auto" for detection. */
  language: string;
}

export async function transcribeWithWhisperCli(opts: TranscribeOptions): Promise<void> {
  if (!(await which("whisper-cli"))) {
    throw new Error(
      "`whisper-cli` not found. Install with: brew install whisper-cpp " +
        "(or run scripts/install_deps.ts).",
    );
  }

  const { input, outputDir, model, language } = opts;
  const modelPath = await resolveModel(model);
  // -of takes a path WITHOUT extension; whisper-cli appends .vtt.
  const outBase = join(outputDir, "subtitle");

  const args = [
    "-m",
    modelPath,
    "-f",
    input,
    "-l",
    language === "auto" ? "auto" : language,
    "-ovtt",
    "-of",
    outBase,
    "-pp", // print progress to stderr
  ];

  process.stderr.write(
    `Running whisper-cli (model=${model}, language=${language}, GPU=Metal)...\n`,
  );
  const onStderr = (line: string) => process.stderr.write(`${line}\n`);
  const exit = await runStreaming("whisper-cli", args, onStderr, onStderr);
  if (exit !== 0) {
    throw new Error(`whisper-cli failed (exit ${exit})`);
  }

  const transcript = await vttToTranscript(join(outputDir, "subtitle.vtt"));
  await Bun.write(join(outputDir, "transcript.txt"), transcript);
}
