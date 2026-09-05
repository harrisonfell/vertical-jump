/**
 * The golden file for the speed climber: the owner fixture's week 7,
 * materialized through the engine and asserted day by day, plus the four
 * readiness states applied to its Thursday.
 *
 * Week 7 of the climber's 12-week program is the Power block's second load
 * week, four days a week on Mon, Tue, Wed and Fri, in the gym from 08:00 to
 * 10:00, with the wall on Tuesday, Thursday and Sunday evenings. It is the
 * week the app boots into, so every number here is a number a screenshot
 * shows.
 *
 * Why this file changed from the Mon/Tue/Thu/Sat week it used to assert
 * (owner's answers of 5 Sep 2026):
 *   1. A wall session is a hard finger session, so the week's one hard finger
 *      day has to SHARE a climbing day with a six-hour gap rather than avoid
 *      one. The gym window moved to the morning and the picks moved to Mon,
 *      Tue, Wed and Fri so Tuesday can carry both.
 *   2. The picks are placed by the wall, not in template order: upper power on
 *      the Tuesday it shares with the wall, the heavy squat on Monday (the
 *      first pick that is not a climbing day), the test on Wednesday (two days
 *      after the squat, Tuesday between them), recovery on Friday. The
 *      fixture's own "today" moved with the test day, to Wed 21 Oct.
 *   3. The second goal is now speed, so R113 puts a 10 to 30 m acceleration
 *      sprint in the Power block. A 10 m acceleration is about two seconds of
 *      work, so it is a moderate-CNS row: R44's two-high-effort cap is spent
 *      by the weekly test and the sport's own maximal jump (the primary goal,
 *      R112, before the secondary one, R113), and the sprint fills in behind
 *      them inside the contact budget.
 *   4. The box squat's entered best set (2 x 305 at RPE 8.5) raises the frozen
 *      max from 320 to 325 lb at the week-2 freeze, so every box-squat load in
 *      the program is one 5 lb step up from where it was.
 *
 * House rules on show: `house.sc.box_squat_main_lift` (Monday's main lift off
 * the entered 320 lb), `house.sc.rnt_valgus_control` (the knee-alignment row,
 * never on a wall day), `house.sc.upper_power_day` and
 * `house.sc.open_hand_grip` (Tuesday's weighted pull-up and explosive pull,
 * both open hand, both in "BW + N lb" notation),
 * `house.sc.sequence_strength_rfd_reactive` (Thursday's approach and
 * quick-contact jumps), `house.sc.readiness_gate` (Thursday's line) and
 * `house.sc.weaker_side_first` (every unilateral row).
 */
import { describe, expect, it } from 'vitest';
import { buildClimberFixture, climberReadinessConfig } from '../src/fixtures/climber.js';
import { CLIMBER_TODAY } from '../src/fixtures/climber.js';
import { FIXTURE_CURRENT_WEEK } from '../src/fixtures/program.js';
import { indexById, loadExercises } from '../src/exercises/index.js';
import { RULESET_V1 } from '../src/ruleset/index.js';
import { applyReadinessAdjustment, scoreReadiness } from '../src/readiness/index.js';
import type { ReadinessState, ReadinessWhoopInput } from '../src/types/readiness.js';
import type { SessionExercise, SessionPlan, WeekPlan } from '../src/types/plan.js';

const fixture = buildClimberFixture();
const byId = indexById(loadExercises().exercises);
const week: WeekPlan = (() => {
  const found = fixture.weeks[FIXTURE_CURRENT_WEEK - 1];
  if (found === undefined) throw new RangeError('the climber fixture has no week 7');
  return found;
})();

function on(weekday: number): SessionPlan {
  const session = week.sessions.find((entry) => entry.weekday === weekday);
  if (session === undefined) throw new RangeError(`week 7 has no session on weekday ${weekday}`);
  return session;
}

function rows(session: SessionPlan): SessionExercise[] {
  return session.blocks.flatMap((block) => block.exercises);
}

function row(session: SessionPlan, exerciseId: string): SessionExercise {
  const found = rows(session).find((entry) => entry.exerciseId === exerciseId);
  if (found === undefined) throw new RangeError(`no ${exerciseId} row`);
  return found;
}

function displays(entry: SessionExercise): string[] {
  return entry.sets.map((set) => set.displayLoad);
}

describe('golden: the climber week 7, Monday Lower Strength', () => {
  const monday = on(1);

  it('is the Power block load week the app boots into', () => {
    expect(week.w).toBe(7);
    expect(week.kind).toBe('load');
    expect(week.blockType).toBe('power');
    expect(monday.dayType).toBe('lower_strength');
    expect(monday.date).toBe('2026-10-19');
  });

  it('runs the box squat as the main lift, off the frozen 325 lb', () => {
    const squat = row(monday, 'box_squat');
    expect(squat.role).toBe('main_lift');
    expect(squat.loadType).toBe('heavy_strength');
    expect(squat.loadMode).toBe('epley');
    expect(squat.sourceLine).toBe('est. 325 lb · Epley from 305 lb × 2');
    // R109 cuts the Power block's main lift to 3 sets; the ladder has climbed
    // two 5 percent steps off its 75 percent start since the block began.
    expect(squat.sets.map((set) => set.loadPercent)).toEqual([80, 85, 90]);
    // 80, 85 and 90 percent of the frozen 325 lb on the 5 lb grid: the entered
    // best set raised the max one step off the entered 320 at the week-2
    // freeze (owner's answer 5).
    expect(displays(squat)).toEqual(['5 × 260 lb', '4 × 275 lb', '3 × 295 lb']);
    expect(squat.sets.map((set) => set.reps)).toEqual([5, 4, 3]);
  });

  it('starts the Power block at 75, 80 and 85 percent of the frozen max', () => {
    // R107: a new block starts at the low end of the range. The spec's own
    // worked ladder (5 x 240 / 4 x 255 / 3 x 270) is 75, 80 and 85 percent of
    // the ENTERED 320 lb and is asserted against that number directly in
    // fixed-climber-spec.loads.test.ts; here the frozen max is the 325 the
    // entered best set raised it to, so every rung is one 5 lb step up.
    const blockStart = fixture.weeks[5];
    const squat = blockStart?.sessions
      .find((session) => session.weekday === 1)
      ?.blocks.flatMap((block) => block.exercises)
      .find((entry) => entry.exerciseId === 'box_squat');
    expect(blockStart?.w).toBe(6);
    expect(squat?.sets.map((set) => set.loadPercent)).toEqual([75, 80, 85]);
    expect(squat?.sets.map((set) => set.displayLoad)).toEqual([
      '5 × 245 lb',
      '4 × 260 lb',
      '3 × 275 lb',
    ]);
  });

  it('carries the knee-alignment row, and names the weaker side on every unilateral row', () => {
    expect(monday.rntScheduled).toBe(true);
    const rnt = rows(monday).find((entry) => byId.get(entry.exerciseId)?.isRnt === true);
    expect(rnt?.block).toBe('injury_prevention_core');
    for (const entry of rows(monday)) {
      if (byId.get(entry.exerciseId)?.unilateral !== true) continue;
      expect(entry.sideNote, entry.exerciseId).toBe('Weaker side first: left');
    }
  });

  it('is the week maximal CNS day and carries no finger work', () => {
    expect(monday.isMaximalCns).toBe(true);
    expect(monday.fingerLoad).toBe('none');
  });
});

describe('golden: the climber week 7, Tuesday upper power', () => {
  const tuesday = on(2);

  it('runs at upper-power intent without becoming a second maximal CNS day', () => {
    expect(tuesday.dayType).toBe('upper_strength');
    expect(tuesday.sessionIntent).toBe('upper_power');
    // Rule 0: R90 and R93 outrank the house rule, so the day between the heavy
    // lift and the jump day is held below the maximal-CNS threshold.
    expect(tuesday.isMaximalCns).toBe(false);
  });

  it('runs the weighted pull-up as the main lift, in added-load notation', () => {
    const pull = row(tuesday, 'weighted_pull_up');
    expect(pull.role).toBe('main_lift');
    // The heavy-strength ladder, not the hypertrophy retag the other sports
    // take on their upper day (house `house.sc.upper_power_day`).
    expect(pull.loadType).toBe('heavy_strength');
    expect(pull.sets.map((set) => set.reps)).toEqual([5, 4, 3]);
    expect(displays(pull)).toEqual(['5 × BW + 30 lb', '4 × BW + 30 lb', '3 × BW + 30 lb']);
    expect(pull.capNote).toBe(
      'Held at 80%: this day sits between your heavy lift and your jumps',
    );
    expect(pull.fingerNote).toBe('Open hand only.');
  });

  it('carries an explosive pull beside it, and a push for the pull (R48)', () => {
    const explosive = rows(tuesday).find(
      (entry) => byId.get(entry.exerciseId)?.rotationGroup === 'explosive_pull',
    );
    expect(explosive, 'the upper power day carries an explosive pull row').toBeDefined();
    expect(explosive?.fingerNote).toBe('Open hand only.');
    const push = rows(tuesday).filter((entry) => byId.get(entry.exerciseId)?.isPressing === true);
    expect(push.length).toBeGreaterThan(0);
  });

  it('is the week hard finger day, and every pulling row is open hand', () => {
    expect(tuesday.fingerLoad).toBe('hard');
    for (const entry of rows(tuesday)) {
      const exercise = byId.get(entry.exerciseId);
      if (exercise?.isPulling !== true) continue;
      expect(exercise.gripMode, entry.exerciseId).toBe('open_hand');
      expect(entry.fingerNote, entry.exerciseId).toBe('Open hand only.');
    }
    // 48 hours: no other session in the week loads the fingers hard.
    expect(week.sessions.filter((session) => session.fingerLoad === 'hard')).toHaveLength(1);
  });

  it('carries the finger tendon work R99 asks for', () => {
    const hang = row(tuesday, 'hangboard_open_hand_hang');
    expect(byId.get(hang.exerciseId)?.tendonTarget).toBe('finger');
    expect(hang.sets.every((set) => set.durationS !== undefined)).toBe(true);
  });
});

describe('golden: the climber week 7, Wednesday Power + Speed', () => {
  const wednesday = on(3);

  it('is the test day, and today', () => {
    expect(wednesday.dayType).toBe('power_speed');
    expect(wednesday.date).toBe(CLIMBER_TODAY);
    expect(wednesday.isTestDay).toBe(true);
    expect(wednesday.testStatus).toBe('planned');
    expect(wednesday.headerSuffixes).toContain('· Test day');
  });

  it('runs the quick-contact jump the Power block asks for', () => {
    const quick = row(wednesday, 'quick_contact_rsi_jump');
    expect(byId.get('quick_contact_rsi_jump')?.plyometric?.contactTime).toBe('fast');
    expect(quick.sets.length).toBeGreaterThan(0);
  });

  it('runs the acceleration sprint R113 asks for, in the Power block, rested per R104', () => {
    const sprint = rows(wednesday).find(
      (entry) => byId.get(entry.exerciseId)?.movementPattern === 'sprint' && entry.block === 'power',
    );
    expect(sprint, 'the Power day carries an acceleration sprint').toBeDefined();
    const meters = byId.get(sprint?.exerciseId ?? '')?.sprintDistanceM ?? 0;
    expect(meters).toBeGreaterThanOrEqual(10);
    expect(meters).toBeLessThanOrEqual(30);
    for (const set of sprint?.sets ?? []) {
      expect(set.distanceM).toBe(meters);
      expect(set.restS).toBeGreaterThanOrEqual(180);
    }
  });

  it('carries no change of direction and no conditioning block', () => {
    expect(wednesday.blocks.map((block) => block.name)).not.toContain('cod');
    expect(wednesday.blocks.map((block) => block.name)).not.toContain('conditioning');
    for (const entry of rows(wednesday)) {
      expect(byId.get(entry.exerciseId)?.codCutsPerRep ?? 0, entry.exerciseId).toBe(0);
    }
  });

  it('stays inside every contact budget', () => {
    expect(wednesday.contacts.highIntensity).toBeLessThanOrEqual(25);
    expect(wednesday.contacts.highAmplitude).toBeLessThanOrEqual(20);
    expect(wednesday.contacts.extensive).toBe(wednesday.contacts.targetExtensive);
    const range = RULESET_V1.constants.extensiveRange.advanced;
    expect(wednesday.contacts.extensive).toBeGreaterThanOrEqual(range.bottom);
    expect(wednesday.contacts.extensive).toBeLessThanOrEqual(range.top);
  });

  it('carries the readiness line: the neuromuscular channel alone today', () => {
    expect(wednesday.readiness?.houseRuleId).toBe('house.sc.readiness_gate');
    expect(wednesday.readiness?.channels[0].name).toBe('autonomic');
    expect(wednesday.readiness?.channels[0].band).toBe('unknown');
    expect(wednesday.readiness?.channels[1].name).toBe('neuromuscular');
    expect(wednesday.readiness?.channels[1].band).toBe('high');
    expect(wednesday.readiness?.line).toBe(
      'Readiness: no recovery score, throw 7.2 m (7-test median 7.1, within 5%). Autonomic unknown, neuromuscular fine: session as written.',
    );
    expect(wednesday.notices).toContain(wednesday.readiness?.line);
    // Nothing was cut, so no header suffix claims a cut.
    expect(wednesday.headerSuffixes).not.toContain('· Readiness: one tier down');
    expect(wednesday.headerSuffixes).not.toContain('· Readiness: volume held');
  });
});

describe('golden: the climber week 7, Friday recovery', () => {
  const saturday = on(5);

  it('is a recovery day with no high-CNS work and no counted contacts', () => {
    expect(saturday.dayType).toBe('recovery_mobility');
    expect(saturday.isMaximalCns).toBe(false);
    expect(saturday.contacts.extensive).toBe(RULESET_V1.constants.contactCaps.recovery);
    for (const entry of rows(saturday)) {
      expect(byId.get(entry.exerciseId)?.cnsCost, entry.exerciseId).not.toBe('high');
    }
    expect(saturday.blocks.at(-1)?.name).toBe('recovery');
  });
});

describe('golden: the week the Plan renders', () => {
  it('names the house rules that were live this week, in ruleset order', () => {
    expect(week.houseRuleIds).toEqual([
      'house.sc.sport_requirements',
      'house.sc.upper_power_day',
      'house.sc.open_hand_grip',
      'house.sc.hard_finger_spacing',
      'house.sc.finger_pain_ceiling',
      'house.sc.rnt_valgus_control',
      'house.sc.weaker_side_first',
      'house.sc.box_squat_main_lift',
      'house.sc.readiness_gate',
      'house.sc.asymmetry_tracking',
      'house.sc.sequence_strength_rfd_reactive',
      'house.sc.calf_volume_low',
    ]);
    for (const id of week.houseRuleIds ?? []) {
      const rule = RULESET_V1.houseRules.find((entry) => entry.id === id);
      expect(rule?.kind, id).toBe('house');
      expect(rule?.text ?? '', id).not.toMatch(/\bR\d+\b/u);
    }
  });

  it('keeps the knee-alignment work off the wall days, twice a week', () => {
    const rnt = week.sessions.filter((session) => session.rntScheduled);
    expect(rnt).toHaveLength(2);
    for (const session of rnt) expect([1, 2]).toContain(session.weekday);
  });

  it('matches the stored WeekPlan', () => {
    expect(week).toMatchSnapshot();
  });
});

describe("golden: the four readiness states applied to the climber's Wednesday", () => {
  const config = climberReadinessConfig();
  const history = fixture.readinessTests.slice(0, -1);
  const today = fixture.readinessTests.at(-1) ?? null;
  const poor = today === null ? null : { ...today, best: 6.2, attempts: [6.0, 6.1, 6.2] };
  const high: ReadinessWhoopInput = { date: CLIMBER_TODAY, score: 72, band: 'high' };
  const low: ReadinessWhoopInput = { date: CLIMBER_TODAY, score: 28, band: 'low' };

  /** The Wednesday as it would be before the gate ran, so a state can be applied. */
  function bare(): SessionPlan {
    const session = { ...on(3) };
    delete session.readiness;
    session.notices = session.notices.filter((line) => !line.startsWith('Readiness:'));
    return session;
  }

  function apply(whoop: ReadinessWhoopInput | null, test: typeof today): {
    state: ReadinessState;
    session: SessionPlan;
  } {
    const outcome = scoreReadiness(config, whoop, test, history, RULESET_V1);
    return {
      state: outcome.state,
      session: applyReadinessAdjustment(bare(), outcome, { exercisesById: byId }),
    };
  }

  const open = bare();

  it('both high runs the session exactly as written', () => {
    const { state, session } = apply(high, today);
    expect(state).toBe('both_high');
    expect(session.trimmed).toEqual(open.trimmed);
    expect(session.contacts.highIntensity).toBe(open.contacts.highIntensity);
    expect(session.contacts.extensive).toBe(open.contacts.extensive);
    expect(session.notices.at(-1)).toContain('session as written');
  });

  it('autonomic low runs the session as written and says the volume is held', () => {
    const { state, session } = apply(low, today);
    expect(state).toBe('autonomic_low');
    expect(session.contacts.highIntensity).toBe(open.contacts.highIntensity);
    expect(session.notices.at(-1)).toContain('volume held');
  });

  it('neuromuscular low takes the maximal jumps out and cuts the jump volume', () => {
    const { state, session } = apply(high, poor);
    expect(state).toBe('neuromuscular_low');
    expect(session.trimmed.some((entry) => entry.reason.startsWith('Readiness low'))).toBe(true);
    expect(session.contacts.highIntensity).toBeLessThan(open.contacts.highIntensity);
    expect(session.contacts.extensive).toBeLessThan(open.contacts.extensive);
    expect(session.testStatus).toBe('deferred');
    expect(session.notices.at(-1)).toContain('maximal jumps out');
  });

  it('both low drops everything one tier and keeps every unreduced row beside it', () => {
    const { state, session } = apply(low, poor);
    expect(state).toBe('both_low');
    expect(session.contacts.highIntensity).toBeLessThan(open.contacts.highIntensity);
    const reduced = rows(session)
      .flatMap((entry) => entry.sets)
      .filter((set) => set.original !== undefined);
    expect(reduced.length).toBeGreaterThan(0);
    for (const set of reduced) {
      const before = set.original;
      if (before === undefined) continue;
      const lighter = (set.loadKg ?? 0) <= (before.loadKg ?? 0);
      const fewer = (set.reps ?? 0) <= (before.reps ?? 0);
      expect(lighter || fewer).toBe(true);
    }
  });

  it('is idempotent and never mutates the session it was given', () => {
    const outcome = scoreReadiness(config, low, poor, history, RULESET_V1);
    const source = bare();
    const before = JSON.stringify(source);
    const once = applyReadinessAdjustment(source, outcome, { exercisesById: byId });
    const twice = applyReadinessAdjustment(once, outcome, { exercisesById: byId });
    expect(JSON.stringify(source)).toBe(before);
    expect(twice).toBe(once);
  });
});
