/**
 * Reading a whole file into the preview the athlete confirms.
 *
 * Nothing here writes. The preview is the only place the import is described,
 * so it carries the counts verbatim in the brief's shape and keeps every row
 * it will commit, which means Confirm has nothing left to decide.
 */
import { analytics } from '@vert/engine';
import type { LocalDate } from '@/data';
import { isBlankRecord, parseCsv, toRecords, type CsvRecord, type SourceSheet } from './csv';
import {
  applyManualMapping,
  mapSheet,
  unrecognizedLine,
  type CanonicalField,
  type MappingResult,
} from './headers';
import {
  readJumpRow,
  readVelocityRow,
  type ParsedJumpRow,
  type ParsedVelocityRow,
  type SkippedRow,
} from './normalize';
import {
  dedupeJumps,
  dedupeVelocitySets,
  type ExistingJump,
  type ExistingVelocitySet,
  type VelocitySetGroup,
} from './dedupe';
import { fileHash } from './hash';

/** What the export type is called on the batch row and in the preview line. */
export const OVR_CONNECT = 'OVR Connect export';

/** A file, read but not yet compared to the database. */
export interface ReadFile {
  readonly fileName: string;
  readonly hash: string;
  readonly header: readonly string[];
  readonly records: readonly CsvRecord[];
  readonly mapping: MappingResult;
  readonly jumps: readonly ParsedJumpRow[];
  readonly velocity: readonly ParsedVelocityRow[];
  readonly skipped: readonly SkippedRow[];
  /** Every data row in the file, header excluded. */
  readonly rowCount: number;
  /** The most recent date any row carried, for the preview line. */
  readonly latestDate: LocalDate | null;
}

const UNMAPPED: MappingResult = { kind: 'unknown', mapping: {}, unrecognized: [], missing: [] };

/**
 * Read and map already-stringified sheets. Pure: the same sheets always read
 * the same, whether they came from a CSV or a workbook.
 *
 * The first sheet decides what the file is and is the one the manual mapping
 * step edits. A second sheet, which is only ever the workbook's velocity
 * sheet, is mapped on its own headers and its rows join the same lists, so a
 * two-sheet export previews and commits as one import.
 */
export function readSheets(
  fileName: string,
  hash: string,
  sheets: readonly SourceSheet[],
  manual?: Readonly<Partial<Record<CanonicalField, string>>>,
): ReadFile {
  const jumps: ParsedJumpRow[] = [];
  const velocity: ParsedVelocityRow[] = [];
  const skipped: SkippedRow[] = [];
  const records: CsvRecord[] = [];

  let primary: MappingResult | undefined;
  let primaryHeader: readonly string[] = [];
  let rowNumber = 0;

  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    if (sheet === undefined) continue;

    const { header, records: parsed } = toRecords(sheet.rows);
    const body = parsed.filter((record) => !isBlankRecord(record));

    const auto = mapSheet(header);
    const useManual = index === 0 && manual !== undefined && Object.keys(manual).length > 0;
    const mapping = useManual ? applyManualMapping(auto, manual ?? {}, header) : auto;
    if (index === 0) {
      primary = mapping;
      primaryHeader = header;
    }

    for (let line = 0; line < body.length; line += 1) {
      const record = body[line];
      if (record === undefined) continue;
      rowNumber += 1;
      records.push(record);

      if (mapping.kind === 'jump') {
        const read = readJumpRow(record, mapping.mapping, rowNumber, line + 1);
        if (read.kind === 'jump') jumps.push(read);
        else skipped.push(read);
        continue;
      }
      if (mapping.kind === 'velocity') {
        const read = readVelocityRow(record, mapping.mapping, rowNumber, 1, line + 1);
        if (read.kind === 'velocity') velocity.push(read);
        else skipped.push(read);
        continue;
      }
      skipped.push({ kind: 'skipped', row: rowNumber, reason: 'columns not recognized' });
    }
  }

  const dates = [...jumps.map((row) => row.date), ...velocity.map((row) => row.date)].sort();

  return {
    fileName,
    hash,
    header: primaryHeader,
    records,
    mapping: primary ?? UNMAPPED,
    jumps,
    velocity,
    skipped,
    rowCount: rowNumber,
    latestDate: dates.length === 0 ? null : (dates[dates.length - 1] ?? null),
  };
}

/** Read and map a file's text. Pure: the same text always reads the same. */
export function readFile(
  fileName: string,
  text: string,
  manual?: Readonly<Partial<Record<CanonicalField, string>>>,
): ReadFile {
  return readSheets(fileName, fileHash(text), [{ name: '', rows: parseCsv(text) }], manual);
}

/** What the database already holds, so the preview can say what is new. */
export interface ExistingData {
  readonly jumps: readonly ExistingJump[];
  readonly velocitySets: readonly ExistingVelocitySet[];
}

export interface ImportPreview {
  readonly file: ReadFile;
  /** True when this exact file has already been committed. */
  readonly alreadyImported: boolean;
  readonly newJumps: readonly ParsedJumpRow[];
  readonly matchedJumps: readonly { readonly row: ParsedJumpRow; readonly existingId: string }[];
  readonly duplicateJumps: number;
  readonly newSets: readonly VelocitySetGroup[];
  readonly matchedSets: readonly { readonly row: VelocitySetGroup; readonly existingId: string }[];
  /** The one line the preview leads with. */
  readonly line: string;
  /** "Columns not recognized: ..." when a manual mapping step is needed. */
  readonly unrecognized: string | null;
  readonly needsMapping: boolean;
}

/** Compare a read file with the database. Still pure, still nothing written. */
export function buildPreview(
  file: ReadFile,
  existing: ExistingData,
  alreadyImported = false,
): ImportPreview {
  const jumpResult = dedupeJumps(file.jumps, existing.jumps);
  const setResult = dedupeVelocitySets(file.velocity, existing.velocitySets);
  const matchedCount = jumpResult.matched.length + setResult.matched.length;

  return {
    file,
    alreadyImported,
    newJumps: jumpResult.added,
    matchedJumps: jumpResult.matched,
    duplicateJumps: jumpResult.duplicate.length,
    newSets: setResult.added,
    matchedSets: setResult.matched,
    line: previewLine({
      date: file.latestDate,
      rowCount: file.rowCount,
      newJumps: jumpResult.added.length,
      newSets: setResult.added.length,
      matched: matchedCount,
    }),
    unrecognized: unrecognizedLine(file.mapping.unrecognized),
    needsMapping: file.mapping.kind === 'unknown' || file.mapping.missing.length > 0,
  };
}

export interface PreviewCounts {
  readonly date: LocalDate | null;
  readonly rowCount: number;
  readonly newJumps: number;
  readonly newSets: number;
  readonly matched: number;
}

/**
 * "OVR Connect export · 14 Nov · 312 rows · 9 new jumps, 41 new sets, 6
 * matched to typed entries" (brief section 06, verbatim).
 */
export function previewLine(counts: PreviewCounts): string {
  const { formatCount, joinParts } = analytics;
  const parts: string[] = [OVR_CONNECT];
  if (counts.date !== null) parts.push(analytics.formatShortDate(counts.date));
  parts.push(`${formatCount(counts.rowCount)} ${plural(counts.rowCount, 'row')}`);
  parts.push(
    [
      `${formatCount(counts.newJumps)} new ${plural(counts.newJumps, 'jump')}`,
      `${formatCount(counts.newSets)} new ${plural(counts.newSets, 'set')}`,
      `${formatCount(counts.matched)} matched to typed entries`,
    ].join(', '),
  );
  return joinParts(parts);
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
