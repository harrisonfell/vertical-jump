/**
 * One chosen row turned into a `SessionExercise`, and the rows grouped into
 * their session blocks.
 *
 * Split out of `assemble.ts` so both files stay under the 500-line limit.
 * Nothing here chooses anything: by the time a row reaches it, Blocks 1 to 5
 * have already filtered, ordered and trimmed. Loads are still not set: Block
 * 6 does that after selection returns.
 */
import { resolveLadderRung } from './filters.js';
import { orderWithinBlock, sortSessionBlocks } from './order.js';
import { isOpenHandOnly } from './sport.js';
import { buildSets } from './volume.js';
import type { ClimbingPlacement } from './sport.js';
import type { Volume } from './volume.js';
import type { PlacedRow } from './trim.js';
import type { SelectContext } from './assemble.js';
import type { ExerciseId, LadderId, SessionBlockName } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SessionBlock, SessionExercise } from '../types/plan.js';

/**
 * House `house.sc.weaker_side_first` and `house.sc.open_hand_grip`: the two
 * per-row lines a climber's session carries. Both are silent for an athlete
 * who has no weaker side on file and no finger-pulley history, so no other
 * sport's rows change.
 */
export function houseRowNotes(
  entry: SessionExercise,
  exercise: Exercise,
  context: SelectContext,
  placement: ClimbingPlacement,
): void {
  const { athlete } = context;
  // What the legs did outranks what the athlete guessed: a per-side RPE gap on
  // logged unilateral work names the harder-working leg, and only when it names
  // none does the setup answer decide.
  const side = context.weakerSideLogged ?? athlete.weakerSide;
  if (exercise.unilateral && (side === 'left' || side === 'right')) {
    entry.sideNote = `Weaker side first: ${side}`;
  }
  if (!exercise.isPulling) return;
  if (!placement.allowHardFinger && exercise.fingerLoad === 'light') {
    entry.fingerNote = 'Light finger work today.';
    return;
  }
  if (isOpenHandOnly(athlete)) entry.fingerNote = 'Open hand only.';
}

export function toSessionExercise(
  row: PlacedRow,
  context: SelectContext,
  volumes: Map<ExerciseId, Volume>,
  notes: Record<ExerciseId, string>,
  placement: ClimbingPlacement,
): SessionExercise {
  const { exercise } = row;
  const sets = buildSets(exercise, row.role, volumes.get(exercise.id), context);
  const first = sets[0];
  const entry: SessionExercise = {
    exerciseId: exercise.id,
    name: exercise.name,
    block: row.block,
    role: row.role,
    loadType: exercise.loadType,
    loadMode: 'none',
    bothSides: exercise.unilateral,
    sets,
    restS: first?.restS ?? 60,
    restRule: first?.restRule ?? 'Longest applicable rest: accessory',
    sourceLine: '',
    landingPromptOnLastSet: exercise.plyometric?.ladderId !== undefined,
    contactsPerRep: exercise.plyometric?.contactsPerRep ?? 0,
    cues: exercise.cues,
  };
  houseRowNotes(entry, exercise, context, placement);
  const note = notes[exercise.id];
  if (note !== undefined) entry.rotationNote = note;
  const ladderId: LadderId | undefined = exercise.plyometric?.ladderId;
  if (ladderId !== undefined) {
    const ladder = context.ladders.find((candidate) => candidate.id === ladderId);
    if (ladder !== undefined) {
      const target = context.week.targets.ladderRungs[ladderId] ?? 0;
      const bodyweightLb = context.athlete.bodyweightKg === null ? null : context.athlete.bodyweightKg * 2.2046226218;
      const rung = resolveLadderRung(ladder, target, context.athlete.inventory, bodyweightLb, exercise);
      entry.ladderId = ladderId;
      entry.rung = rung.rank;
      if (rung.heightIn !== undefined) entry.boxHeightIn = rung.heightIn;
    }
  }
  return entry;
}

export function groupIntoBlocks(
  rows: readonly PlacedRow[],
  context: SelectContext,
  volumes: Map<ExerciseId, Volume>,
  notes: Record<ExerciseId, string>,
  placement: ClimbingPlacement,
): SessionBlock[] {
  const order: SessionBlockName[] = [];
  const byBlock = new Map<SessionBlockName, PlacedRow[]>();
  for (const row of rows) {
    const bucket = byBlock.get(row.block);
    if (bucket === undefined) {
      byBlock.set(row.block, [row]);
      order.push(row.block);
    } else bucket.push(row);
  }
  const blocks: SessionBlock[] = order.map((name) => {
    const bucket = byBlock.get(name) ?? [];
    const ordered = orderWithinBlock(bucket.map((row) => row.exercise));
    const byId = new Map(bucket.map((row) => [row.exercise.id, row]));
    return {
      name,
      grouped: bucket.some((row) => row.grouped),
      exercises: ordered.map((exercise) => {
        const row = byId.get(exercise.id);
        if (row === undefined) throw new RangeError(`lost row ${exercise.id}`);
        return toSessionExercise(row, context, volumes, notes, placement);
      }),
    };
  });
  return sortSessionBlocks(blocks, context.session.dayType);
}

/**
 * Roughly how long the chosen rows take, before Block 6 fills in the loads.
 * Named apart from the materializer's own estimate, which runs on prescribed
 * rows and is the number the session header shows.
 */
export function estimateSelectedMinutes(blocks: readonly SessionBlock[], context: SelectContext): number {
  const warmUpMinutes = context.ruleset.constants.warmUp.minutesMax;
  let seconds = 0;
  for (const block of blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down' || block.name === 'recovery') continue;
    for (const row of block.exercises) {
      for (const set of row.sets) {
        const work = set.durationS ?? 40;
        seconds += work + set.restS;
      }
    }
  }
  return Math.round(warmUpMinutes + seconds / 60 + 5);
}

