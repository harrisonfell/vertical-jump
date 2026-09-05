import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `BootGate` holds the router until migrations finish, which is right in a
 * browser and on a phone and wrong in node: `expo export --platform web`
 * static-renders every route there, effects never run, the database never
 * opens, and each page ships as the boot skeleton instead of its own markup.
 *
 * The gate is a component over a provider whose state only ever arrives from an
 * effect, so proving this without a renderer means reading the source. That is
 * enough for the thing that actually regresses: someone reordering the checks
 * and putting the database ahead of the static pass again.
 */
describe('BootGate static-render pass-through', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./boot.tsx', import.meta.url)),
    'utf8',
  );
  const gate = source.slice(source.indexOf('export function BootGate'));

  it('lets the static pass through', () => {
    expect(gate).toContain("typeof window === 'undefined'");
  });

  it('checks the static pass before it checks the database', () => {
    const staticPass = gate.indexOf("typeof window === 'undefined'");
    const errorCheck = gate.indexOf("status === 'error'");
    const readyCheck = gate.indexOf("status !== 'ready'");
    expect(staticPass).toBeGreaterThan(-1);
    expect(errorCheck).toBeGreaterThan(staticPass);
    expect(readyCheck).toBeGreaterThan(staticPass);
  });

  it('still gates the browser and the phone on the database', () => {
    // The pass-through is the exception, not the new rule: both real states
    // must survive underneath it.
    expect(gate).toContain('<BootError />');
    expect(gate).toContain('<BootSkeleton />');
  });
});

/**
 * The same trap one level up: the root layout holds the tree until the fonts
 * load, and node has no font loader, so without the escape hatch every route
 * exports as an empty shell. Read for the same reason: the readiness value
 * only ever comes out of a hook.
 */
describe('useAppFonts static-render pass-through', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./providers.tsx', import.meta.url)),
    'utf8',
  );

  it('treats the static pass as ready', () => {
    const hook = source.slice(source.indexOf('export function useAppFonts'));
    expect(hook).toContain("typeof window === 'undefined'");
  });
});
