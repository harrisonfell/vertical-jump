/**
 * Dedupe an import against what the athlete already typed.
 *
 * The OVR Connect export is always full history (brief section 07 "Import"),
 * so most of every file is already in the database: either as a typed row the
 * athlete entered off the device's display in the gym, or as a row a previous
 * import wrote. Matching is by date, exercise, set, and value within 0.1 in,
 * the device's own reading precision, so the same rep typed as 32.5 and
 * exported as 32.54 is one rep, not two.
 *
 * A matched row is not discarded: it is counted, so the preview can say "6
 * matched to typed entries", and on commit it backfills the fields typing
 * never captures (contact time, the device's own RSI, per-rep velocities).
 */
import type { LocalDate } from '@/data';
import type { ParsedJumpRow, ParsedVelocityRow } from './normalize';

/** 0.1 in in millimetres: the OVR Jump's reading precision. */
export const HEIGHT_TOLERANCE_MM = 2.54;

/** Half a pound in kilograms: a load grid is 5 lb, so this never collides. */
export const LOAD_TOLERANCE_KG = 0.23;

/** One jump rep already in the database, flattened to what matching needs. */
export interface ExistingJump {
  readonly testId: string;
  readonly repId: string;
  readonly date: LocalDate;
  readonly heightMm: number;
  /** Typed rows can be backfilled; imported rows are already complete. */
  readonly entrySource: 'typed' | 'imported' | 'estimated';
}

/** One velocity set already in the database. */
export interface ExistingVelocitySet {
  readonly id: string;
  readonly date: LocalDate;
  readonly exercise: string;
  readonly set: number;
  readonly loadKg: number | null;
}

export interface DedupeResult<T> {
  /** Rows with no counterpart. These are written on Confirm. */
  readonly added: readonly T[];
  /** Rows that matched something typed. Counted, and used to backfill. */
  readonly matched: readonly { readonly row: T; readonly existingId: string }[];
  /** Rows that matched a previous import. Nothing to do. */
  readonly duplicate: readonly T[];
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Normalised exercise name: case and spacing never make two lifts. */
export function exerciseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Split incoming jump reps into new, matched, and already-imported. Each
 * existing rep can absorb at most one incoming rep, so a session of three
 * attempts at the same height stays three attempts.
 */
export function dedupeJumps(
  incoming: readonly ParsedJumpRow[],
  existing: readonly ExistingJump[],
): DedupeResult<ParsedJumpRow> {
  const byDate = new Map<LocalDate, ExistingJump[]>();
  for (const rep of existing) {
    const bucket = byDate.get(rep.date);
    if (bucket === undefined) byDate.set(rep.date, [rep]);
    else bucket.push(rep);
  }

  const claimed = new Set<string>();
  const added: ParsedJumpRow[] = [];
  const matched: { row: ParsedJumpRow; existingId: string }[] = [];
  const duplicate: ParsedJumpRow[] = [];

  for (const row of incoming) {
    const bucket = byDate.get(row.date) ?? [];
    const hit = bucket.find(
      (rep) => !claimed.has(rep.repId) && near(rep.heightMm, row.heightMm, HEIGHT_TOLERANCE_MM),
    );
    if (hit === undefined) {
      added.push(row);
      continue;
    }
    claimed.add(hit.repId);
    if (hit.entrySource === 'imported') duplicate.push(row);
    else matched.push({ row, existingId: hit.repId });
  }

  return { added, matched, duplicate };
}

/**
 * Split incoming velocity rows by their set. A file carries one row per rep,
 * so rows are grouped into sets first and the set is what matches.
 */
export function dedupeVelocitySets(
  incoming: readonly ParsedVelocityRow[],
  existing: readonly ExistingVelocitySet[],
): DedupeResult<VelocitySetGroup> {
  const groups = groupVelocityRows(incoming);
  const claimed = new Set<string>();
  const added: VelocitySetGroup[] = [];
  const matched: { row: VelocitySetGroup; existingId: string }[] = [];

  for (const group of groups) {
    const hit = existing.find(
      (set) =>
        !claimed.has(set.id) &&
        set.date === group.date &&
        exerciseKey(set.exercise) === exerciseKey(group.exercise) &&
        set.set === group.set &&
        (set.loadKg === null ||
          group.loadKg === null ||
          near(set.loadKg, group.loadKg, LOAD_TOLERANCE_KG)),
    );
    if (hit === undefined) {
      added.push(group);
      continue;
    }
    claimed.add(hit.id);
    matched.push({ row: group, existingId: hit.id });
  }

  return { added, matched, duplicate: [] };
}

/** One set of an exported lift: its reps, plus the summary the store keeps. */
export interface VelocitySetGroup {
  readonly date: LocalDate;
  readonly exercise: string;
  readonly set: number;
  readonly loadKg: number | null;
  readonly reps: readonly ParsedVelocityRow[];
  readonly meanVelocityBest: number | null;
  readonly meanVelocityLast: number | null;
  /** Best to last, as a percentage. The number the velocity cutoff reads. */
  readonly velocityLossPct: number | null;
}

/** Group per-rep rows into sets and derive the velocity loss the app shows. */
export function groupVelocityRows(rows: readonly ParsedVelocityRow[]): VelocitySetGroup[] {
  const groups = new Map<string, ParsedVelocityRow[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = `${row.date}|${exerciseKey(row.exercise)}|${row.set}`;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
      order.push(key);
    } else {
      bucket.push(row);
    }
  }

  return order.map((key) => {
    const reps = [...(groups.get(key) ?? [])].sort((a, b) => a.rep - b.rep);
    const first = reps[0];
    const velocities = reps
      .map((rep) => rep.meanVelocity)
      .filter((value): value is number => value !== null);
    const best = velocities.length === 0 ? null : Math.max(...velocities);
    const last = velocities.length === 0 ? null : (velocities[velocities.length - 1] ?? null);
    const loss = best !== null && last !== null && best > 0 ? ((best - last) / best) * 100 : null;

    return {
      date: first?.date ?? '',
      exercise: first?.exercise ?? '',
      set: first?.set ?? 1,
      loadKg: first?.loadKg ?? null,
      reps,
      meanVelocityBest: best,
      meanVelocityLast: last,
      velocityLossPct: loss,
    };
  });
}
