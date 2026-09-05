/**
 * Turning one mapped record into a typed row, in storage units.
 *
 * Storage is metric and integral where practical (heights mm, loads kg,
 * velocities m/s, contact time ms), and the export's units come from whatever
 * the OVR Connect app was set to, so every value passes through a named
 * converter here rather than being trusted as read. A row that cannot be read
 * is kept with its reason instead of being dropped, so the preview can say how
 * many rows it skipped and why.
 */
import { inToMm, lbToKg } from '@vert/engine';
import type { LocalDate } from '@/data';
import type { CanonicalField, ColumnMapping } from './headers';
import type { CsvRecord } from './csv';

/** The device's own floor and ceiling for a plausible jump (brief section 06). */
export const MIN_HEIGHT_IN = 6;
export const MAX_HEIGHT_IN = 60;

/** A rep is rejected by the device if contact time exceeds one second. */
export const MAX_CONTACT_MS = 1000;
export const MIN_CONTACT_MS = 100;

export interface ParsedJumpRow {
  readonly kind: 'jump';
  readonly date: LocalDate;
  readonly attempt: number;
  readonly heightMm: number;
  readonly gctMs: number | null;
  readonly rsiDevice: number | null;
  readonly mode: string;
  readonly bodyweightKg: number | null;
  readonly notes: string | null;
}

export interface ParsedVelocityRow {
  readonly kind: 'velocity';
  readonly date: LocalDate;
  readonly exercise: string;
  readonly set: number;
  readonly rep: number;
  readonly loadKg: number | null;
  readonly meanVelocity: number | null;
  readonly peakVelocity: number | null;
  readonly romMm: number | null;
  readonly powerW: number | null;
}

export interface SkippedRow {
  readonly kind: 'skipped';
  /** 1-based row number in the file, header excluded. */
  readonly row: number;
  readonly reason: string;
}

export type ParsedRow = ParsedJumpRow | ParsedVelocityRow | SkippedRow;

function cell(record: CsvRecord, mapping: ColumnMapping, field: CanonicalField): string {
  const header = mapping[field];
  if (header === undefined) return '';
  return record.get(header) ?? '';
}

/** A number, or null. Accepts a comma decimal mark and a stray unit suffix. */
export function parseNumber(raw: string): number | null {
  if (raw === '') return null;
  const cleaned = raw
    .replace(/−/g, '-')
    .replace(/[^0-9.,\-+eE]/g, '')
    .trim();
  if (cleaned === '') return null;
  // A lone comma followed by exactly three digits groups thousands ("1,840");
  // any other lone comma is a decimal mark ("0,82"). Dots always win.
  const grouping = /^[+-]?\d{1,3}(,\d{3})+$/.test(cleaned);
  const normalized =
    cleaned.includes('.') || grouping
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * Read a date out of a cell without a timezone conversion: the export's date
 * is already the athlete's own day, and running it through `Date` would move
 * it by one across the international date line.
 *
 * Accepted: 2026-11-14, 2026/11/14, 11/14/2026, 14 Nov 2026, Nov 14 2026, and
 * any of those with a time appended. A two-digit year is refused rather than
 * guessed.
 */
export function parseLocalDate(raw: string): LocalDate | null {
  const text = raw.trim();
  if (text === '') return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (iso !== null) return isoOf(num(iso[1]), num(iso[2]), num(iso[3]));

  const slashed = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text);
  if (slashed !== null) {
    const first = num(slashed[1]);
    const second = num(slashed[2]);
    // Month first is the OVR app's locale default; a first field over 12 can
    // only be a day, so the pair swaps rather than failing.
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return isoOf(num(slashed[3]), month, day);
  }

  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/.exec(text);
  if (dayFirst !== null) {
    const month = MONTHS[(dayFirst[2] ?? '').slice(0, 3).toLowerCase()];
    if (month !== undefined) return isoOf(num(dayFirst[3]), month, num(dayFirst[1]));
  }

  const monthFirst = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (monthFirst !== null) {
    const month = MONTHS[(monthFirst[1] ?? '').slice(0, 3).toLowerCase()];
    if (month !== undefined) return isoOf(num(monthFirst[3]), month, num(monthFirst[2]));
  }

  return null;
}

function num(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

function isoOf(year: number, month: number, day: number): LocalDate | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Height in whichever unit the sheet carried, in millimetres. */
export function heightMmFrom(inches: number | null, centimetres: number | null): number | null {
  if (inches !== null) return inToMm(inches);
  if (centimetres !== null) return centimetres * 10;
  return null;
}

/** Contact time in milliseconds, whether the sheet held ms or seconds. */
export function contactMsFrom(ms: number | null, seconds: number | null): number | null {
  if (ms !== null) return ms;
  if (seconds !== null) return seconds * 1000;
  return null;
}

/** Load in kilograms, whether the sheet held pounds or kilograms. */
export function loadKgFrom(pounds: number | null, kilograms: number | null): number | null {
  if (pounds !== null) return lbToKg(pounds);
  return kilograms;
}

/** Read one jump record. `row` is only used to name a skipped row. */
export function readJumpRow(
  record: CsvRecord,
  mapping: ColumnMapping,
  row: number,
  fallbackAttempt: number,
): ParsedJumpRow | SkippedRow {
  const date = parseLocalDate(cell(record, mapping, 'date'));
  if (date === null) return { kind: 'skipped', row, reason: 'no date' };

  const heightMm = heightMmFrom(
    parseNumber(cell(record, mapping, 'heightIn')),
    parseNumber(cell(record, mapping, 'heightCm')),
  );
  if (heightMm === null) return { kind: 'skipped', row, reason: 'no height' };

  const inches = heightMm / 25.4;
  if (inches < MIN_HEIGHT_IN || inches > MAX_HEIGHT_IN) {
    return { kind: 'skipped', row, reason: 'height outside 6 to 60 in' };
  }

  const gctMs = contactMsFrom(
    parseNumber(cell(record, mapping, 'contactTimeMs')),
    parseNumber(cell(record, mapping, 'contactTimeS')),
  );
  const usableGct = gctMs !== null && gctMs >= MIN_CONTACT_MS && gctMs <= MAX_CONTACT_MS ? gctMs : null;

  const bodyweightKg = loadKgFrom(
    parseNumber(cell(record, mapping, 'bodyweightLb')),
    parseNumber(cell(record, mapping, 'bodyweightKg')),
  );

  const notes = cell(record, mapping, 'notes');
  const modeCell = cell(record, mapping, 'mode').toLowerCase();

  return {
    kind: 'jump',
    date,
    attempt: parseNumber(cell(record, mapping, 'attempt')) ?? fallbackAttempt,
    heightMm,
    gctMs: usableGct,
    rsiDevice: parseNumber(cell(record, mapping, 'rsi')),
    mode: modeCell.includes('rsi') ? 'rsi' : modeCell.includes('gct') ? 'gct' : 'cmj',
    bodyweightKg,
    notes: notes === '' ? null : notes,
  };
}

/** Read one velocity record. */
export function readVelocityRow(
  record: CsvRecord,
  mapping: ColumnMapping,
  row: number,
  fallbackSet: number,
  fallbackRep: number,
): ParsedVelocityRow | SkippedRow {
  const date = parseLocalDate(cell(record, mapping, 'date'));
  if (date === null) return { kind: 'skipped', row, reason: 'no date' };

  const exercise = cell(record, mapping, 'exercise');
  if (exercise === '') return { kind: 'skipped', row, reason: 'no exercise' };

  const romCm = parseNumber(cell(record, mapping, 'romCm'));
  const romIn = parseNumber(cell(record, mapping, 'romIn'));
  const romMm = romIn !== null ? inToMm(romIn) : romCm !== null ? romCm * 10 : null;

  return {
    kind: 'velocity',
    date,
    exercise,
    set: parseNumber(cell(record, mapping, 'set')) ?? fallbackSet,
    rep: parseNumber(cell(record, mapping, 'rep')) ?? fallbackRep,
    loadKg: loadKgFrom(
      parseNumber(cell(record, mapping, 'loadLb')),
      parseNumber(cell(record, mapping, 'loadKg')),
    ),
    meanVelocity: parseNumber(cell(record, mapping, 'meanVelocity')),
    peakVelocity: parseNumber(cell(record, mapping, 'peakVelocity')),
    romMm,
    powerW: parseNumber(cell(record, mapping, 'powerW')),
  };
}
