import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A future day shows the whole workout, read-only.
 *
 * There is no renderer in this test runner, so the guard is on the source: one
 * rendering of a session's blocks, shared with the past view, and not one
 * control that would log against a day that has not happened.
 */

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
}

const future = source('futureView.tsx');
const past = source('pastView.tsx');
const rows = source('exerciseRows.tsx');

describe('the future session view', () => {
  it('renders the session blocks, the same component the past view renders', () => {
    expect(future).toContain("import { SessionBlocks } from './exerciseRows'");
    expect(past).toContain("import { SessionBlocks } from './exerciseRows'");
    expect(future).toContain('<SessionBlocks');
  });

  it('marks the rows as a day still to come, so nothing reads as missed', () => {
    expect(future).toMatch(/<SessionBlocks[\s\S]*?future[\s\S]*?\/>/);
    expect(future).toContain('logs={[]}');
  });

  it('keeps the move affordance and its reason', () => {
    expect(future).toContain('Do this today');
    expect(future).toContain('<Notice text={move.reason} />');
  });

  it('says the loads are projected rather than withholding them', () => {
    expect(future).toContain('PROJECTED_CAPTION');
    expect(future).not.toContain('loads shown on the day');
    expect(future).not.toContain('loads set when week');
  });

  it('offers no way to log, edit or time a set from a future day', () => {
    for (const control of ['<SetRow', 'useLogSet', 'onLog=', 'onUndo=', 'onEdit=', 'useRestTimer']) {
      expect(future).not.toContain(control);
      expect(rows).not.toContain(control);
    }
  });
});
