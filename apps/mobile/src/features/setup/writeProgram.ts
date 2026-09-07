/**
 * Writing a built program: the program, its first version, its blocks, and
 * every week with every one of its sessions.
 *
 * Week 1 is materialized from the athlete's answers; weeks 2 to W are
 * projected from it under the assumption that each week goes as written. Both
 * arrive here as ordinary `WeekPlan`s and are written the same way, so Today
 * and the Plan can open any session of any week. The only difference the
 * database keeps is `generated_by`: 'setup' for week 1, 'projection' for the
 * rest, 'revision' when a later re-materialization replaces them.
 */
import type { SessionPlan, WeekPlan } from '@vert/engine';
import { programStore, sessionStore } from '../../data';
import type { DayType, Json, SqlExecutor, Timestamp } from '../../data';
import type { CreateSessionExerciseInput } from '../../data/store/sessions';
import type { BuildPlan } from './buildProgram';
import { writeStepCount, type WriteProgressListener, type WriteStep } from './buildProgress';

/** The engine's day types in the words brief section 13 uses. */
const DAY_TYPES: Readonly<Record<string, DayType>> = {
  full_body_strength: 'Full Body Strength',
  lower_strength: 'Lower Strength',
  upper_strength: 'Upper Strength',
  upper_mobility: 'Upper + Mobility',
  power_speed: 'Power + Speed',
  power: 'Power',
  speed: 'Speed',
  recovery_mobility: 'Recovery - Mobility',
};

/** The store has no "none" load mode: a row with no max is an entered one. */
const LOAD_MODES: Readonly<Record<string, CreateSessionExerciseInput['loadMode']>> = {
  entered: 'entered',
  epley: 'epley',
  rpe: 'rpe',
  week1: 'week1',
  velocity: 'velocity',
  none: 'entered',
};

function exerciseRowsFor(session: SessionPlan): CreateSessionExerciseInput[] {
  const rows: CreateSessionExerciseInput[] = [];
  let order = 0;
  for (const block of session.blocks) {
    for (const row of block.exercises) {
      const header = [row.sourceLine, row.capNote].filter(
        (line): line is string => typeof line === 'string' && line !== '',
      );
      rows.push({
        exerciseId: row.exerciseId,
        exerciseName: row.name,
        orderIndex: order,
        loadType: row.loadType,
        loadMode: LOAD_MODES[row.loadMode] ?? 'entered',
        block: block.name,
        bothSides: row.bothSides,
        rotationNote: row.rotationNote ?? null,
        isNewThisWeek: row.rotationNote !== undefined,
        headerNote: header.length === 0 ? null : header.join(' · '),
        lastTimeNote: row.lastTimeLine ?? null,
        restS: row.restS,
        restRule: row.restRule,
        perSet: row.sets as unknown as Json,
      });
      order += 1;
    }
  }
  return rows;
}

/** One week's write: the week row itself, then every session it prescribes. */
export interface WriteWeekInput {
  readonly programId: string;
  readonly programVersionId: string | null;
  /** The engine's week, stored verbatim as the week's snapshot. */
  readonly plan: WeekPlan;
  /** 'setup' for week 1 at build, 'projection' for the rest, 'revision' after. */
  readonly generatedBy: string;
  /** The real instant the row was written, not the engine's frozen one. */
  readonly generatedAt: Timestamp;
  /** The "of" in "week 7 of 12". Defaults to the week's own number. */
  readonly weekCount?: number;
}

/**
 * Write one week and its sessions. The week row is an upsert on
 * `(program_id, w)`, so a revision replacing a projected week reuses its id.
 *
 * The caller owns any transaction and, on a revision, owns deleting the old
 * sessions first: this function only ever inserts them. Returns the week id.
 */
export async function writeWeekPlan(
  db: SqlExecutor,
  input: WriteWeekInput,
  landed?: (step: WriteStep) => void,
): Promise<string> {
  const { plan } = input;
  const of = input.weekCount ?? plan.w;
  const saved = await programStore.upsertWeek(db, {
    programId: input.programId,
    programVersionId: input.programVersionId,
    w: plan.w,
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd,
    kind: plan.kind,
    k: plan.snapshot.k,
    prescribedCount: plan.sessions.length,
    repeatOfWeek: plan.repeatOfWeek ?? null,
    extensiveTarget: plan.snapshot.targets.extensiveBottom,
    highContactAllowance: plan.snapshot.targets.highIntensityAllowance,
    ladderRungs: plan.snapshot.targets.ladderRungs as unknown as Json,
    snapshot: plan as unknown as Json,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
  });
  landed?.({ kind: 'week', w: plan.w, of });

  let index = 0;
  const sessionCount = plan.sessions.length;
  for (const session of plan.sessions) {
    await sessionStore.createSession(db, {
      programId: input.programId,
      weekId: saved.id,
      scheduledDate: session.date,
      orderIndex: index,
      dayType: DAY_TYPES[session.dayType] ?? 'Lower Strength',
      testStatus: session.testStatus ?? null,
      isMaximalCns: session.isMaximalCns,
      blocksPresent: session.blocks.map((block) => block.name) as unknown as Json,
      trimmedExercises: session.trimmed as unknown as Json,
      snapshot: session as unknown as Json,
      exercises: exerciseRowsFor(session),
    });
    index += 1;
    landed?.({ kind: 'session', w: plan.w, n: index, of: sessionCount });
  }

  return saved.id;
}

/**
 * Write the program, its first version, its blocks, and every week of the
 * program with every session it prescribes. Returns the program id.
 *
 * `onProgress` hears each awaited write land, in order, so the build screen
 * can draw a determinate bar. `done` starts at `offset`, which is the count of
 * steps the caller has already spent materializing, and `total` is the whole
 * build; the last write lands exactly on it.
 */
export async function writeProgramPlan(
  db: SqlExecutor,
  plan: BuildPlan,
  onProgress?: WriteProgressListener,
  offset = 0,
  total = writeStepCount(plan) + offset,
): Promise<string> {
  const { skeleton, weeks } = plan;
  const lastWeek = skeleton.weeks[skeleton.weeks.length - 1];
  let done = offset;
  const landed = (step: WriteStep): void => {
    done += 1;
    onProgress?.({ done, total, step });
  };

  const { program, version } = await programStore.createProgram(db, {
    rulesetVersion: plan.rulesetVersion,
    seed: String(plan.seed),
    startDate: skeleton.programStart,
    endDate: lastWeek?.windowEnd ?? skeleton.targetDate,
    snapshot: skeleton as unknown as Json,
    weekLayout: skeleton.weeks.map((week) => ({
      w: week.w,
      kind: week.kind,
      blockType: week.blockType,
      windowStart: week.windowStart,
      windowEnd: week.windowEnd,
      k: week.k,
      notes: week.notes,
    })) as unknown as Json,
    reason: 'first build',
    blocks: skeleton.blocks.map((block, index) => ({
      type: block.type,
      orderIndex: index,
      weekStart: block.weekFrom,
      weekEnd: block.weekTo,
    })),
  });
  landed({ kind: 'program' });

  // The instant the build ran, not the engine's frozen per-week value: the row
  // is honest about when it was written (design question 7).
  const generatedAt = plan.generatedAt;
  const weekCount = weeks.length;

  for (const week of weeks) {
    await writeWeekPlan(
      db,
      {
        programId: program.id,
        programVersionId: version.id,
        plan: week,
        generatedBy: week.w === 1 ? 'setup' : 'projection',
        generatedAt,
        weekCount,
      },
      landed,
    );
  }

  return program.id;
}
