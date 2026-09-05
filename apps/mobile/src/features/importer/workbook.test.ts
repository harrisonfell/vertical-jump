import { describe, expect, it } from 'vitest';
import { bytesHash } from './hash';
import { buildPreview, readFile, readSheets } from './preview';
import { cellText, loadXlsx, openPickedFile, selectSheetNames } from './workbook';

describe('workbook', () => {
  const JUMP_SHEET: readonly unknown[][] = [
    ['Date', 'Jump Height (in)', 'Contact Time (ms)', 'Mode'],
    ['2026-11-14', 32.54, 212, 'Regular'],
    ['2026-11-14', 32.1, 218, 'Regular'],
    ['2026-11-07', 31.8, '', 'Regular'],
  ];
  const JUMP_CSV = [
    'Date,Jump Height (in),Contact Time (ms),Mode',
    '2026-11-14,32.54,212,Regular',
    '2026-11-14,32.1,218,Regular',
    '2026-11-07,31.8,,Regular',
  ].join('\n');
  const VELOCITY_SHEET: readonly unknown[][] = [
    ['Date', 'Exercise', 'Set', 'Rep', 'Load (lb)', 'Mean Velocity (m/s)'],
    ['2026-11-14', 'Back Squat', 1, 1, 225, 0.82],
    ['2026-11-14', 'Back Squat', 1, 2, 225, 0.71],
  ];

  interface SheetSpec {
    readonly name: string;
    readonly rows: readonly unknown[][];
    readonly dates?: boolean;
  }

  /** Build a real .xlsx with the same library the importer reads it with. */
  async function workbookBytes(sheets: readonly SheetSpec[]): Promise<Uint8Array> {
    const lib = await loadXlsx();
    const book = lib.utils.book_new();
    for (const sheet of sheets) {
      const rows = sheet.rows.map((row) => [...row]);
      const worksheet =
        sheet.dates === true
          ? lib.utils.aoa_to_sheet(rows, { cellDates: true, UTC: true })
          : lib.utils.aoa_to_sheet(rows);
      lib.utils.book_append_sheet(book, worksheet, sheet.name);
    }
    const written: unknown = lib.write(book, { type: 'array', bookType: 'xlsx' });
    return new Uint8Array(written as ArrayBuffer);
  }

  async function open(bytes: Uint8Array) {
    const source = await openPickedFile({ kind: 'workbook', name: 'ovr.xlsx', bytes });
    if (source === null) throw new Error('the picker returned nothing');
    return source;
  }

  it('reads a jump sheet into exactly the rows the CSV path produces', async () => {
    const source = await open(await workbookBytes([{ name: 'Jumps', rows: JUMP_SHEET }]));
    const file = readSheets(source.fileName, source.hash, source.sheets);

    expect(file.mapping.kind).toBe('jump');
    expect(file.rowCount).toBe(3);
    expect(file.latestDate).toBe('2026-11-14');
    expect(file.jumps).toEqual(readFile('ovr.csv', JUMP_CSV).jumps);
    // The sheet's own precision, not its display rounding.
    expect(file.jumps[0]?.heightMm).toBeCloseTo(826.516, 3);
  });

  it('reads a Velocity sheet beside the first sheet', async () => {
    const source = await open(
      await workbookBytes([
        { name: 'Jump Tests', rows: JUMP_SHEET },
        { name: 'Velocity', rows: VELOCITY_SHEET },
      ]),
    );
    const file = readSheets(source.fileName, source.hash, source.sheets);

    expect(source.sheets.map((sheet) => sheet.name)).toEqual(['Jump Tests', 'Velocity']);
    expect(file.mapping.kind).toBe('jump');
    expect(file.jumps).toHaveLength(3);
    expect(file.velocity).toHaveLength(2);
    expect(file.velocity[0]?.exercise).toBe('Back Squat');
    expect(file.velocity[0]?.loadKg).toBeCloseTo(102.058, 3);
    expect(file.rowCount).toBe(5);
    expect(file.skipped).toEqual([]);

    const preview = buildPreview(file, { jumps: [], velocitySets: [] });
    expect(preview.newJumps).toHaveLength(3);
    expect(preview.newSets).toHaveLength(1);
    expect(preview.needsMapping).toBe(false);
  });

  it('reads a real date cell as the day it was written, in any timezone', async () => {
    const source = await open(
      await workbookBytes([
        {
          name: 'Jumps',
          rows: [
            ['Date', 'Jump Height (in)'],
            [new Date(Date.UTC(2026, 10, 14)), 32.5],
          ],
          dates: true,
        },
      ]),
    );
    const file = readSheets(source.fileName, source.hash, source.sheets);
    expect(file.jumps[0]?.date).toBe('2026-11-14');
  });

  it('asks for a mapping when a sheet’s columns are unknown', async () => {
    const source = await open(
      await workbookBytes([
        { name: 'Sheet1', rows: [['Alpha', 'Beta'], [1, 2]] },
      ]),
    );
    const file = readSheets(source.fileName, source.hash, source.sheets);
    const preview = buildPreview(file, { jumps: [], velocitySets: [] });

    expect(preview.needsMapping).toBe(true);
    expect(preview.unrecognized).toBe('Columns not recognized: Alpha, Beta');
    expect(preview.newJumps).toHaveLength(0);
    expect(file.skipped).toEqual([{ kind: 'skipped', row: 1, reason: 'columns not recognized' }]);

    const mapped = readSheets(source.fileName, source.hash, source.sheets, {
      date: 'Alpha',
      heightIn: 'Beta',
    });
    expect(mapped.mapping.kind).toBe('jump');
  });

  it('makes a reimport of the same workbook a no-op', async () => {
    const sheets = [{ name: 'Jumps', rows: JUMP_SHEET }];
    const first = await open(await workbookBytes(sheets));
    const again = await open(await workbookBytes(sheets));
    expect(again.hash).toBe(first.hash);
    expect(first.hash).not.toBe(bytesHash(new Uint8Array([1, 2, 3])));

    const file = readSheets(first.fileName, first.hash, first.sheets);
    const committed = file.jumps.map((row, index) => ({
      testId: 't1',
      repId: `r${index + 1}`,
      date: row.date,
      heightMm: row.heightMm,
      entrySource: 'imported' as const,
    }));

    const preview = buildPreview(file, { jumps: committed, velocitySets: [] }, true);
    expect(preview.alreadyImported).toBe(true);
    expect(preview.newJumps).toHaveLength(0);
    expect(preview.matchedJumps).toHaveLength(0);
    expect(preview.duplicateJumps).toBe(3);
  });

  it('turns one cell into text without a timezone or a display rounding', () => {
    expect(cellText(new Date(Date.UTC(2026, 10, 14)))).toBe('2026-11-14');
    expect(cellText(32.54)).toBe('32.54');
    expect(cellText('Back Squat')).toBe('Back Squat');
    expect(cellText('')).toBe('');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(Number.NaN)).toBe('');
  });

  it('reads the first sheet, and a velocity sheet when there is one', () => {
    expect(selectSheetNames(['Jump Tests', 'Notes', 'Velocity Sets'])).toEqual([
      'Jump Tests',
      'Velocity Sets',
    ]);
    expect(selectSheetNames(['Sheet1'])).toEqual(['Sheet1']);
    expect(selectSheetNames(['Velocity', 'Jumps'])).toEqual(['Velocity']);
    expect(selectSheetNames([])).toEqual([]);
  });
});
