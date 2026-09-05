/**
 * Reading a whole file into the preview the athlete confirms.
 *
 * Nothing here writes. The preview is the only place the import is described,
 * so it carries the counts verbatim in the brief's shape and keeps every row
 * it will commit, which means Confirm has nothing left to decide.
 */
import { analytics } from '@vert/engine';
import type { LocalDate } from '@/data';
import { isBlankRecord, parseCsv, toRecords, type CsvRecord } from './csv';
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

/** Read and map a file's text. Pure: the same text always reads the same. */
export function readFile(
  fileName: string,
  text: string,
  manual?: Readonly<Partial<Record<CanonicalField, string>>>,
): ReadFile {
  const rows = parseCsv(text);
  const { header, records } = toRecords(rows);
  const body = records.filter((record) => !isBlankRecord(record));

  const auto = mapSheet(header);
  const mapping =
    manual === undefined || Object.keys(manual).length === 0
      ? auto
      : applyManualMapping(auto, manual, header);

  const jumps: ParsedJumpRow[] = [];
  const velocity: ParsedVelocityRow[] = [];
  const skipped: SkippedRow[] = [];

  body.forEach((record, index) => {
    const rowNumber = index + 1;
    if (mapping.kind === 'jump') {
      const read = readJumpRow(record, mapping.mapping, rowNumber, index + 1);
      if (read.kind === 'jump') jumps.push(read);
      else skipped.push(read);
      return;
    }
    if (mapping.kind === 'velocity') {
      const read = readVelocityRow(record, mapping.mapping, rowNumber, 1, index + 1);
      if (read.kind === 'velocity') velocity.push(read);
      else skipped.push(read);
      return;
    }
    skipped.push({ kind: 'skipped', row: rowNumber, reason: 'columns not recognized' });
  });

  const dates = [...jumps.map((row) => row.date), ...velocity.map((row) => row.date)].sort();

  return {
    fileName,
    hash: fileHash(text),
    header,
    records: body,
    mapping,
    jumps,
    velocity,
    skipped,
    rowCount: body.length,
    latestDate: dates.length === 0 ? null : (dates[dates.length - 1] ?? null),
  };
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
