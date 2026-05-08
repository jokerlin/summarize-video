// src/transcribe.ts
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getAudioDuration } from "./ffmpeg.ts";
import { detectSilence } from "./silence.ts";
import { type AudioChunk, findSplitPoints, splitAudio } from "./splitter.ts";
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
      worker.onerror = (e) => {
        const rej = this.rejecters.get(worker);
        if (rej) rej(new Error(`worker errored: ${String(e)}`));
      };
    }
  }

  /** Wait until every worker has loaded its model. */
  async ready(): Promise<void> {
    await Promise.all(
      this.workers.map(
        (w) =>
          new Promise<void>((resolve, reject) => {
            // Worker posts READY at startup; we send LOAD then wait for second READY.
            let phase = 0;
            // biome-ignore lint/suspicious/noExplicitAny: Bun Worker event typing requires any cast
            const handler = (e: any) => {
              const data = e.data as WorkerReply;
              if (data.type === "READY") {
                phase++;
                if (phase === 1) {
                  this.send(w, { type: "LOAD", model: this.modelPath });
                } else {
                  w.removeEventListener("message", handler);
                  resolve();
                }
              } else if (data.type === "ERROR") {
                w.removeEventListener("message", handler);
                reject(new Error(data.message));
              }
            };
            w.addEventListener("message", handler);
          }),
      ),
    );
    this.idle = [...this.workers];
    // Reset onmessage so subsequent replies go through onReply.
    for (const w of this.workers) {
      // biome-ignore lint/suspicious/noExplicitAny: Bun Worker event typing requires any cast
      w.onmessage = (e: any) => this.onReply(w, e.data as WorkerReply);
    }
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
      const res = this.resolvers.get(w);
      if (res) {
        this.resolvers.delete(w);
        this.rejecters.delete(w);
        res({ chunkIdx: reply.chunkIdx, segments: [], startTime: 0, error: reply.message });
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
    await new Promise((r) => setTimeout(r, 200));
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}

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
    process.stderr.write(
      `Transcribing ${chunks.length} chunks with ${effectiveWorkers} workers...\n`,
    );

    pool = new WorkerPool(effectiveWorkers, modelPath);
    await pool.ready();

    const results = new Map<number, ChunkResult>();
    let failed = 0;
    let succeeded = 0;
    await Promise.all(
      chunks.map(async (chunk, idx) => {
        const result = await pool!.dispatch({
          chunkIdx: idx,
          chunkPath: chunk.path,
          startTime: chunk.startOffset,
          language,
        });
        results.set(idx, result);
        if (result.error) {
          failed++;
          process.stderr.write(`  Chunk ${idx + 1}/${chunks.length} failed: ${result.error}\n`);
        } else {
          succeeded++;
          process.stderr.write(`  Chunk ${succeeded}/${chunks.length} completed\n`);
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
