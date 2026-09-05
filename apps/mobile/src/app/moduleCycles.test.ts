import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No require cycle anywhere in the app's own module graph.
 *
 * Metro allows a cycle and only warns, and the warning is easy to live with
 * until it is not: a module part-way round the ring reads a binding its
 * dependency has not finished assigning and gets `undefined`, at import time,
 * with no stack pointing at the cause. The one this guards against ran
 * Settings -> the Whoop barrel -> the Whoop screen -> back to the Settings
 * barrel, and it closed because two Settings modules reached for the barrel
 * when they wanted two small modules inside it.
 *
 * Barrels are the whole hazard: importing `../whoop` pulls in every screen the
 * barrel re-exports, screens import back, and a cycle that no one intended
 * appears. Deep imports into the leaf module are the fix and the rule.
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

/** The file a specifier lands on, or null when it leaves the app's own source. */
function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) base = resolve(dirname(from), specifier).replace(/\\/g, '/');
  else if (specifier.startsWith('@/')) base = `${SRC}/${specifier.slice(2)}`;
  else return null;

  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    const targets = new Set<string>();
    for (const match of source.matchAll(IMPORT_FROM)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = resolveSpecifier(file, specifier);
      if (target !== null && target !== file) targets.add(target);
    }
    graph.set(file, [...targets]);
  }
  return graph;
}

/** Every cycle, each as the ring of files that closes it. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const seen = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const cycles: string[][] = [];

  const walk = (node: string): void => {
    seen.set(node, 'open');
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      if (seen.get(next) === 'open') cycles.push([...path.slice(path.indexOf(next)), next]);
      else if (!seen.has(next)) walk(next);
    }
    path.pop();
    seen.set(node, 'done');
  };

  for (const file of [...graph.keys()].sort()) if (!seen.has(file)) walk(file);
  return cycles;
}

describe('app module graph', () => {
  it('has no import cycles', () => {
    const short = (file: string): string => file.slice(SRC.length + 1);
    const rings = findCycles(importGraph()).map((ring) => ring.map(short).join(' -> '));
    expect(rings).toEqual([]);
  });

  it('reads enough of the app to be worth trusting', () => {
    // A resolver that quietly stopped matching would report zero cycles for the
    // wrong reason, so the graph has to be the size of the app it walked.
    const graph = importGraph();
    expect(graph.size).toBeGreaterThan(150);
    const edges = [...graph.values()].reduce((total, list) => total + list.length, 0);
    expect(edges).toBeGreaterThan(300);
  });
});
