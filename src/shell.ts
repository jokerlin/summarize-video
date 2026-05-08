// src/shell.ts
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars 0x00-0x1f
const RESERVED_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeTitle(s: string, max = 80): string {
  const cleaned = s.replace(RESERVED_CHARS, "_");
  // Slice by code points, not UTF-16 units, so emoji aren't split mid-surrogate.
  const codePoints = [...cleaned];
  const truncated = codePoints.slice(0, max).join("");
  return truncated.replace(/\s+$/u, "");
}

// === which ===

export async function which(bin: string): Promise<string | null> {
  const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout as ReadableStream).text();
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
  const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin ? new Response(opts.stdin).body : "ignore",
  };
  if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd;
  const proc = Bun.spawn([cmd, ...args], spawnOpts);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
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
  const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  };
  if (opts.cwd !== undefined) spawnOpts.cwd = opts.cwd;
  const proc = Bun.spawn([cmd, ...args], spawnOpts);

  const pumpLines = async (stream: ReadableStream<Uint8Array>, onLine: LineHandler) => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // yt-dlp uses \r for in-place progress; treat \r as line break too
      for (;;) {
        const nl = buf.search(/[\r\n]/);
        if (nl === -1) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.length > 0) onLine(line);
      }
    }
    if (buf.length > 0) onLine(buf);
  };

  await Promise.all([
    pumpLines(proc.stdout as unknown as ReadableStream<Uint8Array>, onStdout),
    pumpLines(proc.stderr as unknown as ReadableStream<Uint8Array>, onStderr),
  ]);
  await proc.exited;
  return proc.exitCode ?? 0;
}
