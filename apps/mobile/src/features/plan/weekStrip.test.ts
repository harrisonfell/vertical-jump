import { describe, expect, it } from 'vitest';
import { buildStrip, dayTypeShort, stripColumns, type StripSessionInput } from './weekStrip';

/** Mon 7 Sep 2026 is day 0 of the owner's week. */
const DAY0 = '2026-09-07';

const SESSIONS: StripSessionInput[] = [
  { id: 's1', date: '2026-09-07', dayType: 'Lower Strength', status: 'done', isTest: false },
  { id: 's2', date: '2026-09-08', dayType: 'Upper Strength', status: 'done', isTest: false },
  { id: 's3', date: '2026-09-10', dayType: 'Power + Speed', status: 'planned', isTest: true },
  { id: 's4', date: '2026-09-12', dayType: 'Recovery - Mobility', status: 'planned', isTest: false },
];

function strip(today: string, sessions: StripSessionInput[] = SESSIONS) {
  return buildStrip({
    weeks: [{ w: 1, windowStart: DAY0, kind: 'load' }],
    sessions,
    today,
    currentWeek: 1,
  });
}

describe('stripColumns', () => {
  it('labels the seven columns from day 0s weekday', () => {
    expect(stripColumns(DAY0).map((column) => column.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  it('starts wherever day 0 falls', () => {
    expect(stripColumns('2026-09-10').map((column) => column.label)).toEqual([
      'Thu',
      'Fri',
      'Sat',
      'Sun',
      'Mon',
      'Tue',
      'Wed',
    ]);
  });
});

describe('cell derivation', () => {
  it('draws seven cells a week whatever the training days are', () => {
    expect(strip('2026-09-10').rows[0]?.cells).toHaveLength(7);
  });

  it('reads a day with no session as rest', () => {
    const wednesday = strip('2026-09-10').rows[0]?.cells[2];
    expect(wednesday?.state).toBe('rest');
    expect(wednesday?.stateLabel).toBe('Rest');
    expect(wednesday?.dayTypeShort).toBe('Rest');
    expect(wednesday?.sessionId).toBeNull();
  });

  it('carries the logged state as a word and a glyph, never colour alone', () => {
    const monday = strip('2026-09-10').rows[0]?.cells[0];
    expect(monday?.state).toBe('done');
    expect(monday?.stateLabel).toBe('Done');
    expect(monday?.stateGlyph).toBe('state-done');
    expect(monday?.dayGlyph).toBe('day-strength');
  });

  it('marks the test day', () => {
    const thursday = strip('2026-09-10').rows[0]?.cells[3];
    expect(thursday?.isTest).toBe(true);
    expect(thursday?.label).toContain('test day');
  });

  it('opens a cell only when the session exists', () => {
    const cells = strip('2026-09-10').rows[0]?.cells ?? [];
    expect(cells.filter((cell) => cell.sessionId !== null)).toHaveLength(4);
  });

  it('marks today and reads past days as past', () => {
    const cells = strip('2026-09-10').rows[0]?.cells ?? [];
    expect(cells[3]?.isToday).toBe(true);
    expect(cells[0]?.isPast).toBe(true);
    expect(cells[5]?.isPast).toBe(false);
  });

  it('reads a part-logged session as not finished', () => {
    const changed = SESSIONS.map((session) =>
      session.id === 's1' ? { ...session, status: 'not_finished' as const } : session,
    );
    const monday = strip('2026-09-10', changed).rows[0]?.cells[0];
    expect(monday?.stateLabel).toBe('Not finished');
    expect(monday?.stateGlyph).toBe('state-notfinished');
  });

  it('reads a past day with nothing logged as missed', () => {
    const changed = SESSIONS.map((session) =>
      session.id === 's2' ? { ...session, status: 'missed' as const } : session,
    );
    const tuesday = strip('2026-09-10', changed).rows[0]?.cells[1];
    expect(tuesday?.stateLabel).toBe('Missed');
  });

  it('writes one sentence per cell for a screen reader', () => {
    expect(strip('2026-09-10').rows[0]?.cells[0]?.label).toBe('Mon 7 Sep · Lower Strength · done');
  });
});

describe('rows', () => {
  it('marks the current week and labels a repeat', () => {
    const built = buildStrip({
      weeks: [
        { w: 1, windowStart: DAY0, kind: 'load' },
        { w: 2, windowStart: '2026-09-14', kind: 'load', repeatOfWeek: 1 },
      ],
      sessions: SESSIONS,
      today: '2026-09-16',
      currentWeek: 2,
    });
    expect(built.rows[0]?.isCurrent).toBe(false);
    expect(built.rows[1]?.isCurrent).toBe(true);
    expect(built.rows[1]?.repeatLabel).toBe('Repeat of week 1');
    expect(built.rows[0]?.repeatLabel).toBeNull();
  });

  it('is empty when there are no weeks', () => {
    expect(buildStrip({ weeks: [], sessions: [], today: DAY0, currentWeek: null }).rows).toEqual([]);
  });
});

describe('dayTypeShort', () => {
  it('shortens every day type to something a column can hold', () => {
    expect(dayTypeShort('Power + Speed')).toBe('Power');
    expect(dayTypeShort('Recovery - Mobility')).toBe('Recovery');
    expect(dayTypeShort('Full Body Strength')).toBe('Full body');
    expect(dayTypeShort('Upper Strength')).toBe('Upper');
  });

  it('calls the upper day an upper power day for a sport that runs it as one', () => {
    expect(dayTypeShort('Upper Strength', true)).toBe('Upper power');
  });

  it('leaves every other day type alone whatever the sport', () => {
    expect(dayTypeShort('Lower Strength', true)).toBe('Lower');
    expect(dayTypeShort('Power + Speed', true)).toBe('Power');
  });
});

/**
 * House `house.sc.upper_power_day`: the stored day type stays the rule book's
 * template, and only the word the athlete reads changes.
 */
describe('the upper power day', () => {
  const climbing = SESSIONS.map((session) =>
    session.dayType === 'Upper Strength' ? { ...session, upperPower: true } : session,
  );

  it('renames the cell without renaming the stored day type', () => {
    const tuesday = strip('2026-09-10', climbing).rows[0]?.cells[1];
    expect(tuesday?.dayType).toBe('Upper Strength');
    expect(tuesday?.dayTypeLabel).toBe('Upper power');
    expect(tuesday?.dayTypeShort).toBe('Upper power');
  });

  it('says it in the screen reader sentence too', () => {
    const tuesday = strip('2026-09-10', climbing).rows[0]?.cells[1];
    expect(tuesday?.label).toBe('Tue 8 Sep · Upper power · done');
  });

  it('leaves a sport that does not run one untouched', () => {
    const tuesday = strip('2026-09-10').rows[0]?.cells[1];
    expect(tuesday?.dayTypeLabel).toBe('Upper Strength');
    expect(tuesday?.dayTypeShort).toBe('Upper');
  });
});

describe('react keys (defect D-23)', () => {
  it('gives every cell and every row a key no sibling repeats', () => {
    const built = buildStrip({
      weeks: [
        { w: 1, windowStart: DAY0, kind: 'load' },
        { w: 2, windowStart: '2026-09-14', kind: 'load' },
        { w: 3, windowStart: '2026-09-21', kind: 'deload' },
      ],
      sessions: SESSIONS,
      today: '2026-09-10',
      currentWeek: 1,
    });

    const rowKeys = built.rows.map((row) => row.w);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);

    const cellKeys = built.rows.flatMap((row) => row.cells.map((cell) => cell.key));
    expect(cellKeys).toHaveLength(21);
    expect(new Set(cellKeys).size).toBe(cellKeys.length);

    const columnKeys = built.columns.map((column) => column.key);
    expect(new Set(columnKeys).size).toBe(columnKeys.length);
  });
});
