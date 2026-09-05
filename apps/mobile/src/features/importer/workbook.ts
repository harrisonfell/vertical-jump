/**
 * Turning a picked file into sheets of plain strings.
 *
 * OVR Connect is described as exporting CSV by OVR and as an Excel workbook by
 * reviewers (brief section 10), so both arrive here and both leave as the same
 * thing: a header row and body rows of already-stringified cells, which is
 * exactly what the CSV reader produces. Everything downstream, the mapping,
 * the unit normalization, the dedupe, the preview and the file hash that makes
 * a re-import a no-op, is shared and never learns which format it read.
 *
 * SheetJS is loaded lazily, inside the pick handler, for two reasons. The web
 * build is statically rendered, and a spreadsheet parser has no business
 * running during that render; and the library is large, so an athlete who only
 * ever picks a CSV never pays for it.
 *
 * A workbook is parsed off the first frame and, past two megabytes, in row
 * chunks with a yield between them, so the "Reading file…" state paints and
 * the screen keeps answering while a season of history is read.
 */
import type { WorkSheet } from 'xlsx';
import { parseCsv, type SourceSheet } from './csv';
import { normalizeHeader } from './headers';
import { bytesHash, fileHash } from './hash';
import type { PickedFile } from './pick';

/** The sheet name that holds velocity reps, matched loosely. */
export const VELOCITY_SHEET_HINT = 'velocity';

/** Past this, the read yields between row chunks instead of blocking. */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

/** Rows converted between yields. Small enough to stay under one frame. */
const ROWS_PER_CHUNK = 400;

type XlsxModule = typeof import('xlsx');

let cached: XlsxModule | null = null;

/**
 * Load SheetJS on demand. The browser bundle is imported rather than the node
 * entry point, because that one reaches for `fs` and `stream` and Metro would
 * have to resolve them at build time for a file the app reads from a picker.
 */
export async function loadXlsx(): Promise<XlsxModule> {
  if (cached !== null) return cached;
  const loaded = (await import('xlsx/dist/xlsx.full.min.js')) as unknown as XlsxModule & {
    readonly default?: XlsxModule;
  };
  const lib = loaded.default ?? loaded;
  cached = lib;
  return lib;
}

/** Hand the frame back so the reading state paints before the next block. */
function yieldToUi(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * A date cell as a calendar date. SheetJS builds these at UTC midnight from
 * the workbook's own serial number, so the UTC parts are the day the athlete
 * jumped; reading them locally would move a morning session back a day west
 * of Greenwich.
 */
function isoFromDate(value: Date): string {
  const time = value.getTime();
  if (!Number.isFinite(time)) return '';
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/**
 * One cell as text. Numbers keep their full precision rather than the sheet's
 * display rounding, so 32.54 in never arrives as 32.5.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoFromDate(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return '';
}

/**
 * Which sheets to read: the first one always, plus a velocity sheet when the
 * workbook keeps jumps and lifts apart. Anything else is the export's own
 * bookkeeping and is left alone.
 */
export function selectSheetNames(names: readonly string[]): string[] {
  const first = names[0];
  if (first === undefined) return [];
  const chosen = [first];
  const velocity = names.find(
    (name, index) => index > 0 && normalizeHeader(name).includes(VELOCITY_SHEET_HINT),
  );
  if (velocity !== undefined) chosen.push(velocity);
  return chosen;
}

async function sheetRows(
  lib: XlsxModule,
  sheet: WorkSheet,
  chunked: boolean,
): Promise<string[][]> {
  const ref = sheet['!ref'];
  if (ref === undefined || ref === '') return [];
  const range = lib.utils.decode_range(ref);

  const rows: string[][] = [];
  for (let start = range.s.r; start <= range.e.r; start += ROWS_PER_CHUNK) {
    const end = Math.min(start + ROWS_PER_CHUNK - 1, range.e.r);
    const block = lib.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
      range: { s: { r: start, c: range.s.c }, e: { r: end, c: range.e.c } },
    });
    for (const line of block) rows.push(line.map((value) => cellText(value)));
    if (chunked && end < range.e.r) await yieldToUi();
  }
  return rows;
}

/** Read a workbook's bytes into the sheets the importer cares about. */
export async function readWorkbookSheets(bytes: Uint8Array): Promise<SourceSheet[]> {
  const lib = await loadXlsx();
  const chunked = bytes.byteLength > LARGE_FILE_BYTES;

  // Always give the reading state one frame before the parse blocks.
  await yieldToUi();
  const book = lib.read(bytes, { type: 'array', cellDates: true, UTC: true });

  const sheets: SourceSheet[] = [];
  for (const name of selectSheetNames(book.SheetNames)) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    sheets.push({ name, rows: await sheetRows(lib, sheet, chunked) });
    if (chunked) await yieldToUi();
  }
  return sheets;
}

/** A picked file, read into sheets and hashed, with nothing mapped yet. */
export interface ImportSource {
  readonly fileName: string;
  /** Over the file's own bytes or text, so a re-import is recognised. */
  readonly hash: string;
  readonly sheets: readonly SourceSheet[];
}

/** Read whatever the picker returned. Null when the athlete backed out. */
export async function openPickedFile(picked: PickedFile): Promise<ImportSource | null> {
  if (picked.kind === 'cancelled') return null;
  if (picked.kind === 'text') {
    return {
      fileName: picked.name,
      hash: fileHash(picked.text),
      sheets: [{ name: '', rows: parseCsv(picked.text) }],
    };
  }
  return {
    fileName: picked.name,
    hash: bytesHash(picked.bytes),
    sheets: await readWorkbookSheets(picked.bytes),
  };
}
