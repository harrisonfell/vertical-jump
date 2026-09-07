/**
 * Writing a built program: the program, its first version, its blocks, every
 * week of the skeleton, and week 1's sessions.
 *
 * Weeks 2 to W are written from the skeleton with no snapshot: the Plan's
 * forward view is real, and the loads for week N are set when week N is built.
 */
import type { SessionPlan } from '@vert/engine';
import { nowIso, programStore, sessionStore } from '../../data';
import type { DayType, Json, SqlExecutor } from '../../data';
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

/**
 * Write the program, its first version, its blocks, every week of the
 * skeleton, and week 1's sessions. Returns the program id.
 *
 * `onProgress` hears each awaited write land, in order, so the build screen
 * can draw a determinate bar: `writeStepCount(plan)` steps, the last one at
 * the total.
 */
export async function writeProgramPlan(
  db: SqlExecutor,
  plan: BuildPlan,
  onProgress?: WriteProgressListener,
): Promise<string> {
  const { skeleton, week1 } = plan;
  const lastWeek = skeleton.weeks[skeleton.weeks.length - 1];
  const total = writeStepCount(plan);
  let done = 0;
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

  const generatedAt = nowIso();
  let week1Id: string | null = null;
  const weekCount = skeleton.weeks.length;

  for (const week of skeleton.weeks) {
    const isFirst = week.w === 1;
    const saved = await programStore.upsertWeek(db, {
      programId: program.id,
      programVersionId: version.id,
      w: week.w,
      windowStart: week.windowStart,
      windowEnd: week.windowEnd,
      kind: week.kind,
      k: week.k,
      prescribedCount: isFirst ? week1.sessions.length : week.sessions.length,
      extensiveTarget: week.targets.extensiveBottom,
      highContactAllowance: week.targets.highIntensityAllowance,
      ladderRungs: week.targets.ladderRungs as unknown as Json,
      snapshot: isFirst ? (week1 as unknown as Json) : null,
      generatedAt: isFirst ? generatedAt : null,
      generatedBy: isFirst ? 'setup' : null,
    });
    if (isFirst) week1Id = saved.id;
    landed({ kind: 'week', w: week.w, of: weekCount });
  }

  if (week1Id !== null) {
    let index = 0;
    const sessionCount = week1.sessions.length;
    for (const session of week1.sessions) {
      await sessionStore.createSession(db, {
        programId: program.id,
        weekId: week1Id,
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
      landed({ kind: 'session', n: index, of: sessionCount });
    }
  }

  return program.id;
}
