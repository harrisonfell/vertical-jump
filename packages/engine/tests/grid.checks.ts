/**
 * The per-session and per-week checks the grid runs, split out of
 * `grid.support.ts` so both files stay under the 500-line limit.
 *
 * Every check records a violation against a key instead of throwing, so one
 * pass over the grid answers every invariant test in `invariants.test.ts`.
 */
import { computeExtensiveTarget, dropHeightCapIn } from '../src/budgets.js';
import { diffDays } from '../src/calendar.js';
import { displayedRowCount } from '../src/select/order.js';
import { isDropOffDepthJump } from '../src/select/filters.js';
import { kgToLb } from '../src/units.js';
import type { Exercise } from '../src/types/exercise.js';
import type { MaterializeContext, SessionPlan, WeekPlan } from '../src/types/plan.js';
import { gridSeed } from './grid.seed.js';

/** What one pass over the grid found. */
export interface GridReport {
  weeks: number;
  sessions: number;
  programs: number;
  sampled: string[];
  violations: Record<string, string[]>;
}

/** Record a violation, keeping at most twenty examples per key. */
export function record(report: GridReport, key: string, message: string): void {
  const list = report.violations[key];
  if (list === undefined) report.violations[key] = [message];
  else if (list.length < 20) list.push(message);
}

const seeded = gridSeed;

export const POWER_DAYS = new Set(['power_speed', 'power']);

/**
 * Rows whose volume is set by the contact budgets (R52, R85, R89), not by the
 * rep scheme: R105's rep halving does not govern them, and the week's contact
 * totals are checked instead.
 */
export const CONTACT_GOVERNED = new Set(
  seeded.exercises
    .filter(
      (exercise) =>
        exercise.plyometric !== undefined ||
        exercise.codCutsPerRep !== undefined ||
        exercise.displayMode === 'distance' ||
        exercise.movementPattern === 'sprint' ||
        exercise.movementPattern === 'cod',
    )
    .map((exercise) => exercise.id),
);
const REP_TYPES = new Set(['heavy_strength', 'hypertrophy', 'speed_strength', 'strength_speed']);

export function checkSession(
  report: GridReport,
  session: SessionPlan,
  week: WeekPlan,
  context: MaterializeContext,
  label: string,
  byId: ReadonlyMap<string, Exercise>,
): void {
  const at = `${label} w${week.w} ${session.dayType}`;
  const { athlete } = context;
  const constants = context.ruleset.constants;
  const levelCap = constants.levelTopSetCapPct[athlete.level];
  const bodyweightLb = athlete.bodyweightKg === null ? null : kgToLb(athlete.bodyweightKg);

  if (session.contacts.highIntensity > 25) record(report, 'R85', `${at}: ${session.contacts.highIntensity}`);
  if (session.contacts.highAmplitude > 20) record(report, 'R52', `${at}: ${session.contacts.highAmplitude}`);
  if (displayedRowCount(session.blocks) > 8) record(report, 'display_cap', at);

  let highCns = 0;
  const joints = { knee: 0, spine: 0, shoulder: 0 };

  for (const block of session.blocks) {
    if (block.name === 'warm_up') continue;
    for (const row of block.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise === undefined) {
        record(report, 'seed', `${at}: unknown ${row.exerciseId}`);
        continue;
      }
      if (exercise.cnsCost === 'high') highCns += 1;
      if (exercise.kneeStress === 'high') joints.knee += 1;
      if (exercise.spineStress === 'high') joints.spine += 1;
      if (exercise.shoulderStress === 'high') joints.shoulder += 1;
      if (exercise.unilateral !== row.bothSides) record(report, 'both_sides', `${at}: ${row.exerciseId}`);

      if (exercise.readinessRequired) {
        // The Strength-block and first-block bans are about reversing a
        // landing, so they are scoped to a drop-off depth jump exactly as the
        // filter scopes them. A concentric-biased step-off that pauses in the
        // bottom is the Strength block's own drill and still passes every
        // other gate below.
        const dropOff = isDropOffDepthJump(exercise);
        if (athlete.level === 'beginner') record(report, 'depth_jump_gate', `${at}: beginner`);
        if (dropOff && week.blockType === 'strength') {
          record(report, 'depth_jump_gate', `${at}: strength block`);
        }
        if (week.kind !== 'load') record(report, 'depth_jump_gate', `${at}: ${week.kind}`);
        if (athlete.readinessPassedAt === undefined) {
          record(report, 'depth_jump_gate', `${at}: no readiness`);
        }
        const out = diffDays(session.date, athlete.targetDate);
        if (out >= 0 && out < constants.taper.noDepthJumpsWithinDays) {
          record(report, 'depth_jump_gate', `${at}: ${out} days from target`);
        }
      }

      const height = row.boxHeightIn;
      // Rank 0 of every ladder is equipment-free, so its height is a step or a
      // kerb, not a box out of the inventory.
      if (height !== undefined && row.rung !== 0) {
        const owned = [...athlete.inventory.boxHeightsIn, ...athlete.inventory.hurdleHeightsIn];
        if (!owned.includes(height)) record(report, 'heights', `${at}: ${row.exerciseId} ${height} in`);
      }
      if (height !== undefined && exercise.readinessRequired && height > dropHeightCapIn(bodyweightLb)) {
        record(report, 'heights', `${at}: drop ${height} in`);
      }

      let previousPercent = 0;
      let previousReps = Number.POSITIVE_INFINITY;
      for (const set of row.sets) {
        if (!exercise.loadable && (set.loadPercent !== undefined || set.loadKg !== undefined)) {
          record(report, 'R159', `${at}: ${row.exerciseId}`);
        }
        if (set.loadKg !== undefined) {
          if (set.displayLoad.length === 0) record(report, 'R148', `${at}: ${row.exerciseId}`);
          const lb = kgToLb(set.loadKg);
          const step = athlete.inventory.dumbbells?.incrementLb ?? 5;
          const onGrid =
            Math.abs(lb - Math.round(lb / 5) * 5) < 0.01 ||
            Math.abs(lb - Math.round(lb / step) * step) < 0.01 ||
            Math.abs(lb - Math.round(lb / athlete.inventory.plates.smallestPairLb) * athlete.inventory.plates.smallestPairLb) < 0.01;
          if (!onGrid) record(report, 'R162', `${at}: ${row.exerciseId} ${lb.toFixed(2)} lb`);
        }
        if (set.loadPercent !== undefined) {
          const loadType = row.loadType;
          if (loadType === 'ballistic') {
            const ceiling = constants.loadedJumpCeilingPct[athlete.level];
            if (set.loadPercent > ceiling) record(report, 'ballistic', `${at}: ${set.loadPercent}`);
          } else if (set.loadPercent > levelCap) {
            record(report, 'R154', `${at}: ${row.exerciseId} ${set.loadPercent} > ${levelCap}`);
          }
          if (!athlete.isAdult && set.loadPercent > constants.painCaps.under18CapPct) {
            record(report, 'R1', `${at}: ${set.loadPercent}`);
          }
          if (set.isHeld && set.loadPercent !== previousPercent) {
            record(report, 'R155', `${at}: ${row.exerciseId} held at ${set.loadPercent}`);
          }
          previousPercent = set.loadPercent;
        }
        if (set.reps !== undefined && REP_TYPES.has(row.loadType) && exercise.loadable && !set.isRamp) {
          if (set.reps > previousReps) record(report, 'R161', `${at}: ${row.exerciseId}`);
          previousReps = set.reps;
        }
        if (exercise.displayMode === 'time' && set.durationS === undefined) {
          record(report, 'display_mode', `${at}: ${row.exerciseId} time without durationS`);
        }
        if (exercise.displayMode === 'distance' && set.distanceM === undefined) {
          record(report, 'display_mode', `${at}: ${row.exerciseId} distance without distanceM`);
        }
      }
    }
  }

  if (highCns > 2) record(report, 'R44', `${at}: ${highCns}`);
  if (joints.knee > 2 || joints.spine > 2 || joints.shoulder > 2) {
    record(report, 'R23_R25', `${at}: ${JSON.stringify(joints)}`);
  }

  // Rule 0: a Block 1 exclusion outranks Block 4's volume target, so an
  // athlete whose pain rule removed the plyometrics cannot reach the range.
  // House `house.sc.readiness_gate`: a day the gate held or cut is not the
  // day the R89 formula planned, so its own target is what it is checked
  // against (the caps above still bind it).
  const block1Clear = athlete.painStatus.length === 0 && session.readiness === undefined;
  if (POWER_DAYS.has(session.dayType) && week.kind === 'load' && !athlete.inSeason && block1Clear) {
    const targets = week.snapshot.targets;
    const expected = computeExtensiveTarget(
      targets.extensiveBottom,
      targets.extensiveTop,
      week.snapshot.k,
      Math.max(targets.highIntensityAllowance, session.contacts.highIntensity),
      constants.r89.extensiveStepPerWeek,
      constants.r89.highIntensityFactor,
    );
    if (session.contacts.targetExtensive !== expected) {
      record(report, 'R89', `${at}: ${session.contacts.targetExtensive} vs ${expected}`);
    }
    if (session.contacts.extensive !== session.contacts.targetExtensive) {
      record(report, 'R82_R84', `${at}: ${session.contacts.extensive} vs ${session.contacts.targetExtensive}`);
    }
    const range = constants.extensiveRange[athlete.level];
    if (session.contacts.extensive < range.bottom || session.contacts.extensive > range.top) {
      record(report, 'R82_R84_range', `${at}: ${session.contacts.extensive} outside ${range.bottom}-${range.top}`);
    }
  }
}

/**
 * Prescribed working reps per exercise and the week's counted contacts.
 *
 * R105 is a per-row rule ("cuts planned working reps and contacts to 40 to
 * 50% of the prior week"), so reps are compared row by row: selection legally
 * differs between a load week and a taper, and a week-level sum would compare
 * two different exercise lists.
 */
export function weekTotals(week: WeekPlan): { reps: Record<string, number>; contacts: number } {
  const reps: Record<string, number> = {};
  let contacts = 0;
  for (const session of week.sessions) {
    contacts += session.contacts.extensive + session.contacts.highIntensity;
    for (const block of session.blocks) {
      if (block.name === 'warm_up' || block.name === 'cool_down') continue;
      for (const row of block.exercises) {
        let total = 0;
        for (const set of row.sets) {
          if (set.isRamp) continue;
          total += set.reps ?? 0;
        }
        // The heaviest single session, so a row that appears twice in a week
        // is compared against the same shape, not against a week-level sum.
        reps[row.exerciseId] = Math.max(reps[row.exerciseId] ?? 0, total);
      }
    }
  }
  return { reps, contacts };
}
