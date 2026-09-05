import { describe, expect, it } from 'vitest';
import { detectDelimiter, isBlankRecord, parseCsv, toRecords } from './csv';
import {
  applyManualMapping,
  mapSheet,
  normalizeHeader,
  unrecognizedLine,
} from './headers';
import {
  contactMsFrom,
  heightMmFrom,
  loadKgFrom,
  parseLocalDate,
  parseNumber,
  readJumpRow,
  readVelocityRow,
} from './normalize';
import {
  dedupeJumps,
  dedupeVelocitySets,
  exerciseKey,
  groupVelocityRows,
  type ExistingJump,
} from './dedupe';
import { fileHash } from './hash';
import { buildPreview, previewLine, readFile } from './preview';

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps separators and newlines inside quotes', () => {
    const rows = parseCsv('name,note\n"Back squat","heavy, then\nlight"\n');
    expect(rows[1]).toEqual(['Back squat', 'heavy, then\nlight']);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"say ""hi"""\n')[1]).toEqual(['say "hi"']);
  });

  it('handles CRLF and a byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields and drops blank lines', () => {
    expect(parseCsv('a,b,c\n1,,3\n\n4,5,6')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('closes an unterminated quote at end of input instead of throwing', () => {
    expect(parseCsv('a,b\n"open,2')).toEqual([
      ['a', 'b'],
      ['open,2'],
    ]);
  });

  it('sniffs semicolons and tabs, preferring the comma on a tie', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a,b\n1,2')).toBe(',');
    expect(detectDelimiter('"a;b",c\n1,2')).toBe(',');
  });

  it('pads short rows and names extra columns positionally', () => {
    const { header, records } = toRecords(parseCsv('a,b\n1\n2,3,4'));
    expect(header).toEqual(['a', 'b']);
    expect(records[0]?.get('b')).toBe('');
    expect(records[1]?.get('column 3')).toBe('4');
  });

  it('detects a blank record', () => {
    const { records } = toRecords([
      ['a', 'b'],
      ['', ''],
    ]);
    expect(records[0] !== undefined && isBlankRecord(records[0])).toBe(true);
  });
});

describe('header mapping', () => {
  it('normalises punctuation and units out of a header', () => {
    expect(normalizeHeader('Mean Velocity (m/s)')).toBe('mean velocity m s');
    expect(normalizeHeader('GCT_ms')).toBe('gct ms');
  });

  it('maps an OVR jump sheet', () => {
    const result = mapSheet(['Date', 'Jump Height (in)', 'Contact Time (ms)', 'RSI', 'Mode']);
    expect(result.kind).toBe('jump');
    expect(result.mapping.heightIn).toBe('Jump Height (in)');
    expect(result.mapping.contactTimeMs).toBe('Contact Time (ms)');
    expect(result.missing).toEqual([]);
  });

  it('never lets the bare height alias steal a centimetre column', () => {
    const result = mapSheet(['Date', 'Jump Height (cm)']);
    expect(result.mapping.heightCm).toBe('Jump Height (cm)');
    expect(result.mapping.heightIn).toBeUndefined();
  });

  it('maps an OVR velocity sheet', () => {
    const result = mapSheet([
      'Date',
      'Exercise',
      'Set',
      'Rep',
      'Load (lb)',
      'Mean Velocity (m/s)',
      'Peak Velocity (m/s)',
      'ROM (cm)',
      'Avg Power (W)',
    ]);
    expect(result.kind).toBe('velocity');
    expect(result.mapping.loadLb).toBe('Load (lb)');
    expect(result.mapping.romCm).toBe('ROM (cm)');
  });

  it('reports unknown columns in the brief’s words', () => {
    const result = mapSheet(['Session', 'Whatever', 'Unknowable']);
    expect(result.kind).toBe('unknown');
    expect(unrecognizedLine(result.unrecognized)).toBe(
      'Columns not recognized: Session, Whatever, Unknowable',
    );
  });

  it('takes a manual mapping and re-decides the sheet kind', () => {
    const headers = ['When', 'Höhe'];
    const auto = mapSheet(headers);
    expect(auto.kind).toBe('unknown');
    const manual = applyManualMapping(auto, { date: 'When', heightCm: 'Höhe' }, headers);
    expect(manual.kind).toBe('jump');
    expect(manual.unrecognized).toEqual([]);
    expect(manual.missing).toEqual([]);
  });
});

describe('unit normalization', () => {
  it('reads a number through a comma decimal mark and a unit suffix', () => {
    expect(parseNumber('32.5 in')).toBeCloseTo(32.5, 6);
    expect(parseNumber('0,82')).toBeCloseTo(0.82, 6);
    expect(parseNumber('1,840')).toBe(1840);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('n/a')).toBeNull();
  });

  it('reads every date shape without a timezone shift', () => {
    expect(parseLocalDate('2026-11-14')).toBe('2026-11-14');
    expect(parseLocalDate('2026/11/14 06:41')).toBe('2026-11-14');
    expect(parseLocalDate('11/14/2026')).toBe('2026-11-14');
    expect(parseLocalDate('14/11/2026')).toBe('2026-11-14');
    expect(parseLocalDate('14 Nov 2026')).toBe('2026-11-14');
    expect(parseLocalDate('Nov 14, 2026')).toBe('2026-11-14');
    expect(parseLocalDate('11/14/26')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
  });

  it('converts height, contact time and load into storage units', () => {
    expect(heightMmFrom(32.5, null)).toBeCloseTo(825.5, 3);
    expect(heightMmFrom(null, 82.55)).toBeCloseTo(825.5, 3);
    expect(heightMmFrom(null, null)).toBeNull();
    expect(contactMsFrom(null, 0.212)).toBeCloseTo(212, 6);
    expect(loadKgFrom(225, null)).toBeCloseTo(102.058, 3);
    expect(loadKgFrom(null, 100)).toBe(100);
  });

  it('skips a jump row outside the device’s own bounds', () => {
    const mapping = { date: 'Date', heightIn: 'Height' } as const;
    const record = new Map([
      ['Date', '2026-11-14'],
      ['Height', '4.0'],
    ]);
    const read = readJumpRow(record, mapping, 3, 1);
    expect(read.kind).toBe('skipped');
    expect(read.kind === 'skipped' ? read.reason : '').toBe('height outside 6 to 60 in');
  });

  it('drops a contact time the device would have rejected but keeps the rep', () => {
    const mapping = { date: 'Date', heightIn: 'Height', contactTimeMs: 'GCT' } as const;
    const record = new Map([
      ['Date', '2026-11-14'],
      ['Height', '32.5'],
      ['GCT', '1400'],
    ]);
    const read = readJumpRow(record, mapping, 1, 1);
    expect(read.kind).toBe('jump');
    expect(read.kind === 'jump' ? read.gctMs : 0).toBeNull();
  });

  it('reads a velocity row and falls back to the row index for the rep', () => {
    const mapping = { date: 'Date', exercise: 'Exercise', meanVelocity: 'MV' } as const;
    const record = new Map([
      ['Date', '2026-11-14'],
      ['Exercise', 'Back Squat'],
      ['MV', '0.82'],
    ]);
    const read = readVelocityRow(record, mapping, 1, 2, 4);
    expect(read.kind).toBe('velocity');
    if (read.kind !== 'velocity') return;
    expect(read.set).toBe(2);
    expect(read.rep).toBe(4);
    expect(read.meanVelocity).toBeCloseTo(0.82, 6);
  });
});

const jumpRow = (date: string, heightMm: number, attempt = 1) =>
  ({
    kind: 'jump',
    date,
    attempt,
    heightMm,
    gctMs: null,
    rsiDevice: null,
    mode: 'cmj',
    bodyweightKg: null,
    notes: null,
  }) as const;

describe('dedupe', () => {
  const typed: ExistingJump[] = [
    { testId: 't1', repId: 'r1', date: '2026-11-14', heightMm: 825.5, entrySource: 'typed' },
    { testId: 't1', repId: 'r2', date: '2026-11-14', heightMm: 812.8, entrySource: 'typed' },
  ];

  it('matches a typed rep within 0.1 in and adds the rest', () => {
    const result = dedupeJumps(
      [jumpRow('2026-11-14', 827.0), jumpRow('2026-11-14', 800.0, 3)],
      typed,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.existingId).toBe('r1');
    expect(result.added).toHaveLength(1);
  });

  it('never lets two incoming reps claim one typed rep', () => {
    const result = dedupeJumps(
      [jumpRow('2026-11-14', 825.5), jumpRow('2026-11-14', 825.5, 2)],
      [typed[0] as ExistingJump],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  it('counts a previously imported rep as a duplicate, not a match', () => {
    const result = dedupeJumps(
      [jumpRow('2026-11-14', 825.5)],
      [{ ...(typed[0] as ExistingJump), entrySource: 'imported' }],
    );
    expect(result.duplicate).toHaveLength(1);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(0);
  });

  it('never matches across dates', () => {
    const result = dedupeJumps([jumpRow('2026-11-15', 825.5)], typed);
    expect(result.added).toHaveLength(1);
  });

  it('groups velocity reps into sets and derives the loss', () => {
    const rows = [
      { kind: 'velocity', date: '2026-11-14', exercise: 'Back Squat', set: 1, rep: 1, loadKg: 100, meanVelocity: 0.8, peakVelocity: null, romMm: null, powerW: null },
      { kind: 'velocity', date: '2026-11-14', exercise: 'Back squat', set: 1, rep: 2, loadKg: 100, meanVelocity: 0.64, peakVelocity: null, romMm: null, powerW: null },
    ] as const;
    const groups = groupVelocityRows([...rows]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reps).toHaveLength(2);
    expect(groups[0]?.velocityLossPct).toBeCloseTo(20, 6);
  });

  it('matches a set on date, exercise, set number and load', () => {
    const rows = [
      { kind: 'velocity', date: '2026-11-14', exercise: 'Back Squat', set: 1, rep: 1, loadKg: 100, meanVelocity: 0.8, peakVelocity: null, romMm: null, powerW: null },
    ] as const;
    const result = dedupeVelocitySets([...rows], [
      { id: 'v1', date: '2026-11-14', exercise: 'back squat', set: 1, loadKg: 100 },
    ]);
    expect(result.matched).toHaveLength(1);
    expect(result.added).toHaveLength(0);
  });

  it('normalises an exercise name for matching', () => {
    expect(exerciseKey('Back Squat')).toBe(exerciseKey('back-squat'));
  });
});

describe('file hash', () => {
  it('is stable and differs on any change', () => {
    expect(fileHash('a,b\n1,2')).toBe(fileHash('a,b\n1,2'));
    expect(fileHash('a,b\n1,2')).not.toBe(fileHash('a,b\n1,3'));
    expect(fileHash('')).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(fileHash('anything'))).toBe(true);
  });
});

describe('preview', () => {
  const text = [
    'Date,Jump Height (in),Contact Time (ms),Mode',
    '2026-11-14,32.5,,Regular',
    '2026-11-14,32.1,,Regular',
    '2026-11-07,31.8,,Regular',
    '',
  ].join('\n');

  it('reads a jump export and finds its latest date', () => {
    const file = readFile('ovr.csv', text);
    expect(file.mapping.kind).toBe('jump');
    expect(file.jumps).toHaveLength(3);
    expect(file.rowCount).toBe(3);
    expect(file.latestDate).toBe('2026-11-14');
  });

  it('writes the preview line in the brief’s words', () => {
    expect(
      previewLine({ date: '2026-11-14', rowCount: 312, newJumps: 9, newSets: 41, matched: 6 }),
    ).toBe(
      'OVR Connect export · 14 Nov · 312 rows · 9 new jumps, 41 new sets, 6 matched to typed entries',
    );
  });

  it('singularises a count of one', () => {
    expect(previewLine({ date: null, rowCount: 1, newJumps: 1, newSets: 1, matched: 0 })).toBe(
      'OVR Connect export · 1 row · 1 new jump, 1 new set, 0 matched to typed entries',
    );
  });

  it('separates new rows from ones already typed', () => {
    const file = readFile('ovr.csv', text);
    const preview = buildPreview(file, {
      jumps: [
        { testId: 't1', repId: 'r1', date: '2026-11-14', heightMm: 825.5, entrySource: 'typed' },
      ],
      velocitySets: [],
    });
    expect(preview.matchedJumps).toHaveLength(1);
    expect(preview.newJumps).toHaveLength(2);
    expect(preview.needsMapping).toBe(false);
    expect(preview.unrecognized).toBeNull();
  });

  it('asks for a mapping when nothing is recognised', () => {
    const preview = buildPreview(readFile('x.csv', 'Alpha,Beta\n1,2\n'), {
      jumps: [],
      velocitySets: [],
    });
    expect(preview.needsMapping).toBe(true);
    expect(preview.unrecognized).toBe('Columns not recognized: Alpha, Beta');
    expect(preview.newJumps).toHaveLength(0);
  });
});
