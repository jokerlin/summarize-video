// src/cleanup.ts — lightweight signal-cleanup registry
const hooks: Set<() => Promise<void> | void> = new Set();

export function register(fn: () => Promise<void> | void): void {
  hooks.add(fn);
}

export function unregister(fn: () => Promise<void> | void): void {
  hooks.delete(fn);
}

export async function runAll(): Promise<void> {
  for (const fn of hooks) {
    try {
      await fn();
    } catch {
      // ignore errors during cleanup
    }
  }
}
