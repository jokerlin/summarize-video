#!/usr/bin/env bun
// src/cli.ts
import { mkdir, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { downloadAudio, downloadSubtitles, downloadVideo, getMetadata } from "./download.ts";
import { sanitizeTitle, which } from "./shell.ts";
import { findSubtitleFile, vttToTranscript } from "./subtitles.ts";
import { transcribeParallel } from "./transcribe.ts";
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
    process.stderr.write(`Error: missing <url>\n\n${USAGE}`);
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
      `Error: missing required binaries: ${missing.join(", ")}\nRun: bun run skills/video-summarizer/scripts/install_deps.ts\n`,
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
        `Warning: only ${(free / 1024 ** 3).toFixed(1)} GB free on ${dir}'s filesystem (recommend >= 2 GB). Pass --no-disk-check to silence this.\n`,
      );
    }
  } catch {
    // statfs unsupported — silently skip
  }
}

const cleanupHooks: Array<() => Promise<void> | void> = [];

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
  const cookiesOpt =
    opts.cookiesFromBrowser !== undefined ? { cookiesFromBrowser: opts.cookiesFromBrowser } : {};
  const meta = await getMetadata(opts.url, cookiesOpt);
  const safeTitle = sanitizeTitle(meta.title);
  const outDir = join(opts.output, safeTitle);
  await mkdir(outDir, { recursive: true });
  process.stderr.write(`Output dir: ${outDir}\n`);

  if (!opts.skipVideo) {
    process.stderr.write("Downloading video...\n");
    await downloadVideo(opts.url, outDir, cookiesOpt);
  }

  process.stderr.write("Extracting audio...\n");
  await downloadAudio(opts.url, outDir, cookiesOpt);

  process.stderr.write("Trying to fetch subtitles...\n");
  let source: SubtitleSource;
  const subTier = await downloadSubtitles(opts.url, outDir, cookiesOpt);
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
    const transcribeOpts: Parameters<typeof transcribeParallel>[0] = {
      input: audioPath,
      outputDir: outDir,
      model: opts.model,
      language: opts.language,
      minSegment: opts.minSegment,
    };
    if (opts.workers !== undefined) {
      transcribeOpts.workers = opts.workers;
    }
    const report = await transcribeParallel(transcribeOpts);
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
    `${[
      "✓ video.mp4",
      "✓ audio.mp3",
      `✓ subtitle.vtt    (source: ${source})`,
      "✓ transcript.txt",
      "⚠ summary.md      (skill mode only — Claude generates this)",
    ].join("\n")}\n`,
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
