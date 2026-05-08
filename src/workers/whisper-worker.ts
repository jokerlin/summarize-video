// src/workers/whisper-worker.ts
// Bun Worker entry point. Receives WorkerMessage, posts WorkerReply.
//
// smart-whisper API notes (verified from node_modules/smart-whisper/dist/index.d.ts):
//   - new Whisper(file, { gpu: boolean, offload: number })
//   - whisper.transcribe(pcm: Float32Array, params?) → Promise<TranscribeTask>
//   - task.result → Promise<TranscribeSimpleResult[]>
//   - TranscribeSimpleResult = { from: number, to: number, text: string }
//     where from/to are in MILLISECONDS — we normalise to seconds before posting
//   - whisper.free() → Promise<void>
//   - language "auto" is accepted directly (passed straight to whisper.cpp)

import { Whisper } from "smart-whisper";
import type { Segment, WorkerMessage, WorkerReply } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers for self-typed postMessage / onmessage in a Bun Worker context
//
// The tsconfig uses lib: ["ES2023"] (no DOM / WebWorker), so `self` is not in
// scope for TypeScript. We reach for `globalThis` instead — at runtime inside
// a Bun Worker, globalThis IS the worker global scope and has postMessage /
// onmessage / close.
// ---------------------------------------------------------------------------
// biome-ignore lint/suspicious/noExplicitAny: worker global has no TS typings in this lib config
const workerSelf = globalThis as any;

function post(msg: WorkerReply): void {
  (workerSelf as { postMessage: (m: WorkerReply) => void }).postMessage(msg);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let whisper: Whisper | null = null;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
(workerSelf as { onmessage: (e: MessageEvent<WorkerMessage>) => void }).onmessage = async (
  e: MessageEvent<WorkerMessage>,
) => {
  const msg = e.data;

  switch (msg.type) {
    case "LOAD": {
      try {
        // Construct the Whisper instance; model will be lazily loaded on first transcribe.
        // gpu: true enables Metal on macOS Apple Silicon and CUDA on Linux (if compiled with it).
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

        // Decode audio file → mono 16kHz Float32 PCM using ffmpeg
        const pcm = await loadPcm(chunkPath);

        // smart-whisper accepts "auto" directly as a language value per README
        const task = await whisper.transcribe(pcm, {
          language: language,
          suppress_blank: true,
        });

        // task.result is a Promise<TranscribeSimpleResult[]>
        // TranscribeSimpleResult = { from: number; to: number; text: string }
        // from/to are in MILLISECONDS — convert to seconds for our Segment type
        const results = await task.result;
        const segments: Segment[] = results.map((seg) => ({
          start: seg.from / 1000,
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
        // Ignore errors during teardown — the worker is exiting anyway
      }
      whisper = null;
      // Ack so the pool can wait for whisper.cpp's Metal/CUDA context teardown
      // to finish before forcibly terminating us. Without this ack, terminate()
      // interrupts native cleanup and the process exits with SIGTRAP (133).
      post({ type: "SHUTDOWN_DONE" });
      (workerSelf as { close: () => void }).close();
      return;
    }
  }
};

// ---------------------------------------------------------------------------
// PCM loader — ffmpeg pipe to stdout
// ---------------------------------------------------------------------------
/**
 * Decode an audio file to mono Float32 PCM at 16 kHz using ffmpeg.
 * smart-whisper (whisper.cpp) requires: mono, 16 kHz, f32le encoding.
 */
async function loadPcm(path: string): Promise<Float32Array> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      path,
      "-f",
      "f32le", // 32-bit little-endian float samples
      "-ar",
      "16000", // resample to 16 kHz
      "-ac",
      "1", // downmix to mono
      "-", // write to stdout
    ],
    { stdout: "pipe", stderr: "ignore" },
  );

  const buf = await new Response(proc.stdout).arrayBuffer();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`ffmpeg PCM decode failed for ${path} (exit code ${proc.exitCode})`);
  }

  return new Float32Array(buf);
}

// ---------------------------------------------------------------------------
// Signal readiness immediately so the pool knows the worker script loaded.
// A second READY is posted after LOAD once the Whisper instance is constructed.
// ---------------------------------------------------------------------------
post({ type: "READY" });
