import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No zustand selector may build a fresh object or array.
 *
 * zustand subscribes through `useSyncExternalStore`, which compares the value
 * a selector returns against the last one with `Object.is`. A selector written
 * `useSessionStore((state) => ({ a: state.a, b: state.b }))` returns a new
 * object on every call, so the comparison never holds: React re-renders, calls
 * the selector again, sees another new object, and re-renders again. On the web
 * that is a synchronous spin on the main thread, which does not surface as a
 * React "maximum update depth" error. It surfaces as a tab that stops
 * responding, with no console output to say why.
 *
 * The rule is therefore one selector per field, which returns the field itself
 * and compares by identity. When several fields really are wanted in one call,
 * `useShallow` from 'zustand/react/shallow' is the wrapper that makes a fresh
 * object safe, and this scan allows it.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry).replace(/\\/g, '/');
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(path);
  }
  return out;
}

/**
 * A store hook called with an inline arrow whose body opens on `({` or `[`.
 * `useShallow(...)` and a plain `(state) => state.field` both start on other
 * characters and are left alone.
 */
const FRESH_VALUE_SELECTOR = /use[A-Z]\w*Store\(\s*\([^)]*\)\s*=>\s*(\(\s*\{|\[)/g;

/** Every store hook call, so a scan that stopped matching cannot pass quietly. */
const STORE_HOOK_CALL = /use[A-Z]\w*Store\(/g;

describe('zustand selectors', () => {
  const files = sourceFiles(SRC);

  it('never return a freshly built object or array', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(FRESH_VALUE_SELECTOR)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('found the store hooks it was meant to check', () => {
    const calls = files.reduce(
      (total, file) => total + [...readFileSync(file, 'utf8').matchAll(STORE_HOOK_CALL)].length,
      0,
    );
    expect(calls).toBeGreaterThan(3);
  });
});
