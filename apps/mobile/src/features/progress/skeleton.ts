import type { PlanSkeleton } from '@vert/engine';
import type { Program } from '@/data';

/**
 * The plan skeleton the program was built from, read off its snapshot column.
 *
 * Progress reads two things from it: how many weeks the program actually has
 * (the materialized weeks are only the ones built so far), and, before the
 * first test exists, the date of the next test day. Both are facts the
 * skeleton settles at generation, so neither is inferred from what happens to
 * be in the database this evening.
 */
export function readProgramSkeleton(program: Program | null): PlanSkeleton | null {
  if (program === null) return null;
  const snapshot = program.snapshot;
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  if (typeof record['W'] !== 'number') return null;
  if (!Array.isArray(record['weeks'])) return null;
  return snapshot as unknown as PlanSkeleton;
}

/** W, the program's own week count, or null when the snapshot cannot say. */
export function programWeekCount(program: Program | null): number | null {
  const skeleton = readProgramSkeleton(program);
  if (skeleton === null || skeleton.W <= 0) return null;
  return skeleton.W;
}

/** The first test day on or after `from`, from the skeleton's own calendar. */
export function nextSkeletonTestDate(program: Program | null, from: string): string | null {
  const skeleton = readProgramSkeleton(program);
  if (skeleton === null) return null;
  for (const week of skeleton.weeks) {
    for (const session of week.sessions) {
      if (session.isTestDay && session.date >= from) return session.date;
    }
  }
  return null;
}
