import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The rules module only, never the barrel: the barrel pulls the sheet in, and
// the sheet pulls react-native in, which node cannot parse.
import { blankAttempt, readDraft, type Attempt, type TestDraft } from '@/features/test/validate';

/**
 * Today's jump test and the Log jump test sheet are one grid.
 *
 * The runner used to carry a second copy: a stepper that opened on a bold
 * "0.0" and a full-width "Landed outside the field" button under every
 * attempt, while the sheet already had the empty placeholder and the 44 px
 * Flag chip. Two grids means the next rule about what counts lands on one of
 * them, so the runner now renders the test feature's own `AttemptRow` and asks
 * `readDraft` the same question the sheet asks.
 *
 * The behaviour is tested through `readDraft`, which is what both call; the
 * source checks are here so a future edit cannot quietly fork the grid again.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const TODAY_FORM = read('./testForm.tsx');
const ATTEMPT_ROW = read('../test/attemptRow.tsx');
const TEST_SHEET = read('../test/sheet.tsx');
// The sheet's attempt grids moved into their own per-mode panels file, so
// "the sheet" is the pair: the grid is the test feature's, wherever it sits.
const TEST_PANELS = read('../test/modePanels.tsx');
const STEPPER = read('../../ui/primitives/stepper.tsx');
const TEST_BARREL = read('../test/index.ts');

function draft(attempts: readonly Attempt[], instrument: TestDraft['instrument']): TestDraft {
  return {
    instrument,
    attempts,
    bodyweightLb: 190,
    boxHeightIn: null,
    notes: '',
    canonical: true,
  };
}

describe('Today and the sheet render one attempt row', () => {
  it('takes the row and the rules from the test feature', () => {
    expect(TODAY_FORM).toMatch(/AttemptRow/);
    expect(TODAY_FORM).toMatch(/readDraft/);
    expect(TODAY_FORM).toMatch(/from '@\/features\/test'/);
    expect(`${TEST_SHEET}${TEST_PANELS}`).toMatch(/AttemptRow/);
    expect(TEST_SHEET).toMatch(/readDraft/);
  });

  it('exports the row and the rules from the test feature barrel', () => {
    expect(TEST_BARREL).toMatch(/export \{ AttemptRow/);
    for (const name of ['blankAttempt', 'readDraft', 'summaryLine', 'isRsiMode']) {
      expect(TEST_BARREL).toContain(name);
    }
  });

  it('keeps no second copy of the grid in the runner', () => {
    // The old runner-only validators and the old flag button.
    expect(TODAY_FORM).not.toMatch(/validateAttempts|emptyAttempts|liveReadout|canSave\(/);
    expect(TODAY_FORM).not.toContain('Landed outside the field');
  });
});

describe('the flag is a chip beside the stepper, not a button under it', () => {
  it('reads Flag until it is set, then Flagged', () => {
    expect(ATTEMPT_ROW).toMatch(/attempt\.flagged \? 'Flagged' : 'Flag'/);
    expect(ATTEMPT_ROW).toMatch(/<Chip/);
    expect(ATTEMPT_ROW).not.toMatch(/<Button/);
  });

  it('keeps the whole sentence as what a screen reader hears', () => {
    expect(ATTEMPT_ROW).toMatch(/accessibilityLabel=\{`Flag attempt \$\{number\} as outside the field`\}/);
  });

  it('is 44 px, because the chip primitive is', () => {
    expect(read('../../ui/primitives/chip.tsx')).toContain('minHeight: 44');
  });
});

describe('an empty attempt shows a muted placeholder, never a value', () => {
  it('asks the stepper for a placeholder rather than formatting a zero', () => {
    expect(ATTEMPT_ROW).toContain('placeholder={HEIGHT_PLACEHOLDER}');
    expect(ATTEMPT_ROW).toMatch(/attempt\.heightIn === null \? '' :/);
  });

  it('draws it in ink3 in both the typed and the read-only field', () => {
    expect(STEPPER).toContain('placeholderTextColor: colors.ink3');
    expect(STEPPER).toMatch(/placeholder !== undefined \? 'ink3' : 'ink'/);
  });

  it('starts every attempt with no height at all', () => {
    expect(blankAttempt('ovr_jump_regular')).toEqual({
      heightIn: null,
      gctMs: null,
      flagged: false,
    });
  });
});

describe('Save waits for one unflagged attempt inside 6 to 60 in', () => {
  const empty: Attempt[] = [
    blankAttempt('ovr_jump_regular'),
    blankAttempt('ovr_jump_regular'),
    blankAttempt('ovr_jump_regular'),
  ];

  it('is off while every row is empty', () => {
    expect(readDraft(draft(empty, 'ovr_jump_regular'), null).canSave).toBe(false);
  });

  it('is off when the only number is under the device floor', () => {
    const attempts = [{ heightIn: 5.9, gctMs: null, flagged: false }];
    expect(readDraft(draft(attempts, 'ovr_jump_regular'), null).canSave).toBe(false);
  });

  it('is off when the only number is over the ceiling', () => {
    const attempts = [{ heightIn: 60.1, gctMs: null, flagged: false }];
    expect(readDraft(draft(attempts, 'ovr_jump_regular'), null).canSave).toBe(false);
  });

  it('is off when the only number is flagged', () => {
    const attempts = [{ heightIn: 32.5, gctMs: null, flagged: true }];
    expect(readDraft(draft(attempts, 'ovr_jump_regular'), null).canSave).toBe(false);
  });

  it('is on with one unflagged attempt inside the bounds', () => {
    const attempts = [
      { heightIn: 32.5, gctMs: null, flagged: false },
      ...empty.slice(1),
    ];
    const reading = readDraft(draft(attempts, 'ovr_jump_regular'), null);
    expect(reading.canSave).toBe(true);
    expect(reading.bestIn).toBe(32.5);
    expect(reading.counted).toBe(1);
  });

  it('stays on at the two bounds themselves', () => {
    expect(
      readDraft(draft([{ heightIn: 6, gctMs: null, flagged: false }], 'ovr_jump_regular'), null)
        .canSave,
    ).toBe(true);
    expect(
      readDraft(draft([{ heightIn: 60, gctMs: null, flagged: false }], 'ovr_jump_regular'), null)
        .canSave,
    ).toBe(true);
  });
});
