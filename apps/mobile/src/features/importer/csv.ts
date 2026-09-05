/**
 * A hand-written RFC 4180 CSV reader.
 *
 * OVR Connect's export is described as CSV by OVR and as an Excel workbook by
 * reviewers (brief section 10), and the real file has never been seen, so this
 * parser is deliberately forgiving: it accepts CRLF or LF, a UTF-8 byte-order
 * mark, quoted fields containing separators and newlines, doubled quotes as an
 * escape, and comma, semicolon or tab as the separator. It never throws on a
 * malformed row; a stray quote closes at end of input and the row still lands,
 * because refusing to read the athlete's only copy of their history is worse
 * than reading it imperfectly and showing the preview.
 */

/** Separators the sniffed reader will consider, in preference order. */
export const DELIMITERS = [',', ';', '\t'] as const;

export type Delimiter = (typeof DELIMITERS)[number];

const BOM = '﻿';

/**
 * Guess the separator from the first non-empty line, counting only characters
 * outside quotes. Comma wins ties, so a plain export never sniffs sideways.
 */
export function detectDelimiter(text: string): Delimiter {
  const line = firstLogicalLine(text);
  let best: Delimiter = ',';
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    const count = countOutsideQuotes(line, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function firstLogicalLine(text: string): string {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) return body.slice(0, i);
  }
  return body;
}

function countOutsideQuotes(line: string, needle: string): number {
  let quoted = false;
  let count = 0;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === needle) count += 1;
  }
  return count;
}

/**
 * Parse a whole file into rows of fields. Blank lines are dropped, because a
 * spreadsheet export ends with one and an empty row is not a record.
 */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  const sep = delimiter ?? detectDelimiter(text);
  const body = text.startsWith(BOM) ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < body.length) {
    const char = body[i];

    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === sep) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      endRow();
      i += body[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += char ?? '';
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * One sheet of a source file, already stringified. A CSV is one of these; a
 * workbook is one per sheet the importer reads.
 */
export interface SourceSheet {
  /** The workbook's own sheet name, or '' for a CSV, which has no name. */
  readonly name: string;
  readonly rows: readonly string[][];
}

/** One record: the header row zipped onto a body row, trimmed. */
export type CsvRecord = ReadonlyMap<string, string>;

/**
 * Split a parsed sheet into its header and its records. Short rows are padded
 * and long rows keep their extra columns under a positional key, so a file
 * with a ragged tail still previews.
 */
export function toRecords(rows: readonly string[][]): {
  readonly header: string[];
  readonly records: CsvRecord[];
} {
  const [first, ...rest] = rows;
  if (first === undefined) return { header: [], records: [] };
  const header = first.map((cell) => cell.trim());

  const records = rest.map((cells) => {
    const record = new Map<string, string>();
    for (let i = 0; i < Math.max(header.length, cells.length); i += 1) {
      const key = header[i] ?? `column ${i + 1}`;
      record.set(key, (cells[i] ?? '').trim());
    }
    return record;
  });

  return { header, records };
}

/** True when every field on the row is empty. */
export function isBlankRecord(record: CsvRecord): boolean {
  for (const value of record.values()) if (value !== '') return false;
  return true;
}
