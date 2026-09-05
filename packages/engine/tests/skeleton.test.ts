/**
 * The skeleton: the layout table at every program length, the calendar the
 * weeks sit on, the two plyometric budgets per week, and how an outcome moves
 * the program forward.
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1 } from '../src/ruleset/index.js';
import { computeExtensiveTarget } from '../src/budgets.js';
import { diffDays, isWithin, programWeeks } from '../src/calendar.js';
import {
  DATE_AT_RISK_LINE,
  absorbRepeatDetailed,
  applyOutcomeToSkeleton,
  blocksFor,
  chainFor,
  dayTypesFor,
  extensiveTargetFor,
  highIntensityFor,
  layoutFor,
  layoutForChained,
  layoutTextFor,
  planSkeleton,
  retargetWeek,
  startingRungFor,
  tendonModeFor,
  testWeekdayIndexFor,
  upperHalfBottom,
  weekAt,
} from '../src/skeleton/index.js';
import type { OutcomeDecision } from '../src/types/logs.js';
import type { Level } from '../src/types/core.js';
import { MONDAY, TARGET, buildAthlete, buildInventory } from './skeleton.support.js';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

function progressDecision(): OutcomeDecision {
  return {
    kind: 'progress',
    deltaK: 1,
    deltaExtensiveContacts: 10,
    deltaStartPct: 5,
    allowLadderAdvance: false,
    workingMaxDeltaPct: {},
    volumeCutPct: 0,
    line: '',
  };
}

function repeatDecision(): OutcomeDecision {
  return {
    kind: 'repeat',
    deltaK: 0,
    deltaExtensiveContacts: 0,
    deltaStartPct: 0,
    allowLadderAdvance: false,
    workingMaxDeltaPct: {},
    volumeCutPct: 0,
    line: '',
  };
}

describe('layout table, W 2 to 16', () => {
  it('sums block weeks to W and ends on a peak week at every level', () => {
    for (let W = 2; W <= 16; W += 1) {
      for (const level of LEVELS) {
        const weeks = layoutFor(RULESET_V1, W, level);
        expect(weeks.length, `W ${W} ${level}`).toBe(W);
        expect(weeks[W - 1]?.kind, `W ${W} ${level}`).toBe('peak');
        const blocks = blocksFor(weeks);
        const total = blocks.reduce((sum, block) => sum + (block.weekTo - block.weekFrom + 1), 0);
        expect(total, `W ${W} ${level}`).toBe(W);
      }
    }
  });

  it('gives beginners a Strength block first at every W of 4 or more', () => {
    for (let W = 4; W <= 16; W += 1) {
      expect(layoutFor(RULESET_V1, W, 'beginner')[0]?.blockType, `W ${W}`).toBe('strength');
    }
    expect(layoutFor(RULESET_V1, 2, 'beginner')[0]?.blockType).toBe('power');
    expect(layoutFor(RULESET_V1, 3, 'beginner')[0]?.blockType).toBe('power');
  });

  it('keeps the advanced rows verbatim where the table gives them', () => {
    expect(layoutTextFor(RULESET_V1, 4, 'advanced')).toBe('Power 1-3 - Peak 4');
    expect(layoutTextFor(RULESET_V1, 4, 'beginner')).toBe('Strength 1-3 - Peak 4');
    expect(layoutTextFor(RULESET_V1, 5, 'advanced')).toBe('Power 1-4 - Peak 5');
    expect(layoutTextFor(RULESET_V1, 5, 'beginner')).toBe('Strength 1-4 - Peak 5');
    expect(layoutTextFor(RULESET_V1, 12, 'advanced')).toBe(
      'Strength 1-4 - Deload 5 - Power 6-10 - Taper 11 - Peak 12',
    );
  });

  it('follows a 4-week strength block with a deload (R106)', () => {
    for (let W = 2; W <= 16; W += 1) {
      const weeks = layoutFor(RULESET_V1, W, 'advanced');
      for (const block of blocksFor(weeks)) {
        const loads = weeks.filter(
          (week) => week.w >= block.weekFrom && week.w <= block.weekTo && week.kind === 'load',
        );
        if (block.type !== 'strength' || loads.length < 4) continue;
        const after = weeks.find((week) => week.w === (loads[loads.length - 1]?.w ?? 0) + 1);
        expect(after?.kind, `W ${W}`).toBe('deload');
      }
    }
  });

  it('tapers only from W of 9 (brief: 1 week when W is 9 or more)', () => {
    for (let W = 2; W <= 16; W += 1) {
      const hasTaper = layoutFor(RULESET_V1, W, 'advanced').some((week) => week.kind === 'taper');
      expect(hasTaper, `W ${W}`).toBe(W >= RULESET_V1.constants.taper.minProgramWeeks);
    }
  });

  it('chains 12-week programs past the table', () => {
    expect(chainFor(RULESET_V1, 16)).toEqual({ chained: false, programWeeks: 16, remainingWeeks: 0 });
    expect(chainFor(RULESET_V1, 17)).toEqual({ chained: true, programWeeks: 12, remainingWeeks: 5 });
    const chained = layoutForChained(RULESET_V1, 30, 'advanced');
    expect(chained.chained).toBe(true);
    expect(chained.weeks.length).toBe(12);
    expect(chained.remainingWeeks).toBe(18);
    expect(() => layoutFor(RULESET_V1, 17, 'advanced')).toThrow(/chain 12-week programs/);
  });
});

describe('planSkeleton calendar', () => {
  it('starts on the first day 0 on or after today and derives W from the dates', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    expect(skeleton.programStart).toBe(MONDAY);
    expect(skeleton.W).toBe(12);
    expect(programWeeks(MONDAY, TARGET)).toBe(12);
    expect(skeleton.weeks[0]?.windowStart).toBe(MONDAY);
    expect(skeleton.weeks[0]?.windowEnd).toBe('2026-09-13');
  });

  it('waits for the next day 0 when today is past it', () => {
    const skeleton = planSkeleton(buildAthlete(), '2026-09-08', RULESET_V1);
    expect(skeleton.programStart).toBe('2026-09-14');
  });

  it('puts the peak week around the target date', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const peak = skeleton.weeks[skeleton.W - 1];
    expect(peak?.kind).toBe('peak');
    expect(peak).toBeDefined();
    if (peak === undefined) return;
    expect(isWithin(TARGET, { start: peak.windowStart, end: peak.windowEnd })).toBe(true);
    const test = peak.sessions.find((session) => session.isTestDay);
    expect(test?.date).toBe(TARGET);
    const peakSession = peak.sessions[0];
    expect(peakSession).toBeDefined();
    if (peakSession === undefined) return;
    expect(diffDays(peakSession.date, TARGET)).toBe(5);
    const mobility = peak.sessions.find((session) => session.dayType === 'recovery_mobility');
    expect(mobility === undefined ? -1 : diffDays(mobility.date, TARGET)).toBe(2);
    expect(peak.notes.join(' ')).toContain('rest Sat');
  });

  it('lays sessions on the chosen weekdays in template order', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const week1 = skeleton.weeks[0];
    expect(week1?.sessions.map((session) => session.date)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-10',
      '2026-09-12',
    ]);
    expect(week1?.sessions.map((session) => session.dayType)).toEqual(dayTypesFor(4));
    expect(skeleton.testWeekdayIndex).toBe(2);
    expect(week1?.sessions[2]?.isTestDay).toBe(true);
  });

  it('reads the templates and the test slot verbatim from R133 to R136', () => {
    expect(dayTypesFor(2)).toEqual(['full_body_strength', 'power_speed']);
    expect(dayTypesFor(3)).toEqual(['full_body_strength', 'upper_mobility', 'power_speed']);
    expect(dayTypesFor(4)).toEqual([
      'lower_strength',
      'upper_strength',
      'power_speed',
      'recovery_mobility',
    ]);
    expect(dayTypesFor(5)).toEqual([
      'lower_strength',
      'upper_strength',
      'power',
      'speed',
      'recovery_mobility',
    ]);
    expect(testWeekdayIndexFor(2)).toBe(1);
    expect(testWeekdayIndexFor(3)).toBe(2);
    expect(testWeekdayIndexFor(4)).toBe(2);
    expect(testWeekdayIndexFor(5)).toBe(2);
  });
});

describe('per-week targets', () => {
  it('runs the high-intensity schedule 15, 17, 21, 25, 25, 25 and halves it in a deload', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const allowances = skeleton.weeks.map((week) => week.targets.highIntensityAllowance);
    expect(allowances).toEqual([15, 15, 15, 15, 7, 17, 21, 25, 25, 25, 10, 10]);
    const depthJumps = skeleton.weeks.map((week) => week.targets.depthJumpReps);
    expect(depthJumps).toEqual([0, 0, 0, 0, 0, 6, 8, 10, 10, 10, 0, 0]);
  });

  it('never schedules depth jumps for a beginner or without readiness', () => {
    const beginner = planSkeleton(
      buildAthlete({ trainingAge: 'lt1', level: 'beginner' }),
      MONDAY,
      RULESET_V1,
    );
    expect(beginner.weeks.every((week) => week.targets.depthJumpReps === 0)).toBe(true);
    const unready = planSkeleton(buildAthlete({ readinessPassedAt: undefined }), MONDAY, RULESET_V1);
    expect(unready.weeks.every((week) => week.targets.depthJumpReps === 0)).toBe(true);
  });

  it('halves jump contacts in season', () => {
    const inSeason = planSkeleton(buildAthlete({ inSeason: true }), MONDAY, RULESET_V1);
    expect(inSeason.weeks.map((week) => week.targets.highIntensityAllowance)).toEqual([
      7, 7, 7, 7, 3, 8, 10, 12, 12, 12, 5, 5,
    ]);
    expect(inSeason.weeks[5]?.targets.depthJumpReps).toBe(3);
  });

  it('applies the R89 trade, with the worked Power day pinned at 60', () => {
    const range = { bottom: 60, top: 100 };
    expect(computeExtensiveTarget(60, 100, 1, 21)).toBe(60);
    expect(extensiveTargetFor(range, 1, 21, RULESET_V1)).toBe(60);
    expect(extensiveTargetFor(range, 6, 10, RULESET_V1)).toBe(100);
    expect(upperHalfBottom(range)).toBe(80);
    expect(extensiveTargetFor(range, 0, 0, RULESET_V1)).toBe(80);
  });

  it('keeps the level range verbatim and starts every load type at its low end', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    for (const week of skeleton.weeks) {
      expect(week.targets.extensiveBottom).toBe(80);
      expect(week.targets.extensiveTop).toBe(120);
      expect(week.targets.startOffsetPct.heavy_strength).toBe(0);
      expect(week.k).toBe(0);
    }
  });

  it('keeps the back squat across the transition and rotates accessories every 3 weeks', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    for (const week of skeleton.weeks) {
      expect(week.targets.mainLiftBySlot.lower).toBe('back_squat');
      expect(week.targets.mainLiftBySlot.fullbody).toBe('back_squat');
    }
    expect(skeleton.weeks[0]?.targets.accessoryRotationSlot).toBe(0);
    expect(skeleton.weeks[2]?.targets.accessoryRotationSlot).toBe(0);
    expect(skeleton.weeks[3]?.targets.accessoryRotationSlot).toBe(1);
    expect(skeleton.weeks[5]?.targets.accessoryRotationSlot).toBe(0);
  });

  it('runs the R100 tendon runway only for a raw training age of None', () => {
    const runway = planSkeleton(buildAthlete({ trainingAge: 'none' }), MONDAY, RULESET_V1);
    expect(runway.weeks.map((week) => week.targets.tendonMode)).toEqual([
      'isometric',
      'isometric',
      'slow_resistance',
      'slow_resistance',
      'slow_resistance',
      'plyometric',
      'plyometric',
      'plyometric',
      'plyometric',
      'plyometric',
      'plyometric',
      'plyometric',
    ]);
    expect(tendonModeFor('4plus', 1, 0, 'strength')).toBe('slow_resistance');
    expect(tendonModeFor('4plus', 6, 1, 'power')).toBe('plyometric');
  });

  it('notes week 1, the deload, the taper and the block transition', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    expect(skeleton.weeks[0]?.notes.join(' ')).toContain('one maximal effort session');
    expect(skeleton.weeks[4]?.notes.join(' ')).toContain('Deload week (5 of 12)');
    expect(skeleton.weeks[5]?.notes.join(' ')).toContain('Power block begins (week 6)');
    expect(skeleton.weeks[10]?.notes.join(' ')).toContain('Taper week (11 of 12)');
  });

  it('starts a ladder at the highest rung the inventory reaches', () => {
    const ladder = {
      id: 'box_jump_height',
      name: 'Box jump',
      rungs: [
        { rank: 0, label: 'Squat jump', equipment: [] },
        { rank: 1, label: '12 in box', heightIn: 12, equipment: ['box' as const] },
        { rank: 2, label: '24 in box', heightIn: 24, equipment: ['box' as const] },
        { rank: 3, label: '30 in box', heightIn: 30, equipment: ['box' as const] },
      ],
    };
    expect(startingRungFor(ladder, buildInventory())).toBe(2);
    expect(startingRungFor(ladder, buildInventory({ boxHeightsIn: [] }))).toBe(0);
  });

  it('reads the high-intensity schedule directly', () => {
    const base = {
      blockType: 'power' as const,
      kind: 'load' as const,
      level: 'advanced' as const,
      depthJumpsAllowed: true,
      previousAllowance: 15,
      inSeason: false,
    };
    expect(
      [0, 1, 2, 3, 4, 5].map(
        (loadWeekOrdinal) =>
          highIntensityFor({ ...base, loadWeekOrdinal }, RULESET_V1).highIntensityAllowance,
      ),
    ).toEqual([17, 21, 25, 25, 25, 25]);
  });
});

describe('outcomes move the skeleton', () => {
  it('raises k and the extensive floor for the weeks after w only', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const advanced = applyOutcomeToSkeleton(skeleton, 6, progressDecision(), RULESET_V1);
    expect(weekAt(advanced.skeleton, 6)?.k).toBe(0);
    expect(weekAt(advanced.skeleton, 7)?.k).toBe(1);
    expect(weekAt(advanced.skeleton, 12)?.k).toBe(1);
    expect(weekAt(advanced.skeleton, 6)?.targets.extensiveBottom).toBe(80);
    expect(weekAt(advanced.skeleton, 7)?.targets.extensiveBottom).toBe(90);
    expect(weekAt(advanced.skeleton, 7)?.targets.startOffsetPct.heavy_strength).toBe(5);
  });

  it('resets the starting offsets at a block start (R107)', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const advanced = applyOutcomeToSkeleton(skeleton, 4, progressDecision(), RULESET_V1);
    expect(weekAt(advanced.skeleton, 5)?.targets.startOffsetPct.heavy_strength).toBe(5);
    expect(weekAt(advanced.skeleton, 6)?.targets.startOffsetPct.heavy_strength).toBe(0);
  });

  it('repeats week w into w + 1 and takes a load week off the longest block', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const result = absorbRepeatDetailed(skeleton, 3, RULESET_V1);
    expect(result.skeleton.weeks.length).toBe(12);
    expect(result.dateAtRisk).toBe(false);
    expect(result.droppedTaper).toBe(false);
    expect(weekAt(result.skeleton, 4)?.repeatOfWeek).toBe(3);
    expect(result.skeleton.weeks.map((week) => `${week.blockType}:${week.kind}`)).toEqual([
      'strength:load',
      'strength:load',
      'strength:load',
      'strength:load',
      'strength:load',
      'strength:deload',
      'power:load',
      'power:load',
      'power:load',
      'power:load',
      'power:taper',
      'power:peak',
    ]);
    expect(result.skeleton.weeks[11]?.windowStart).toBe(skeleton.weeks[11]?.windowStart);
  });

  it('flags the date when nothing is left to remove and never overwrites the peak', () => {
    const short = planSkeleton(buildAthlete({ targetDate: '2026-09-21' }), MONDAY, RULESET_V1);
    expect(short.W).toBe(3);
    const result = absorbRepeatDetailed(short, 2, RULESET_V1);
    expect(result.dateAtRisk).toBe(true);
    expect(weekAt(result.skeleton, 3)?.kind).toBe('peak');
    expect(weekAt(result.skeleton, 3)?.notes).toContain(DATE_AT_RISK_LINE);
  });

  it('cuts the next week 25 percent when R131 fires', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const decision = { ...repeatDecision(), volumeCutPct: 25 };
    const advanced = applyOutcomeToSkeleton(skeleton, 7, decision, RULESET_V1);
    const cut = weekAt(advanced.skeleton, 8);
    expect(cut?.targets.extensiveBottom).toBe(60);
    expect(cut?.targets.extensiveTop).toBe(90);
    expect(weekAt(advanced.skeleton, 9)?.targets.extensiveTop).toBe(120);
  });

  it('retargets one week without touching the rest', () => {
    const skeleton = planSkeleton(buildAthlete(), MONDAY, RULESET_V1);
    const week = retargetWeek(skeleton, 6, RULESET_V1, { depthJumpReps: 4 });
    expect(week.targets.depthJumpReps).toBe(4);
    expect(weekAt(skeleton, 6)?.targets.depthJumpReps).toBe(6);
  });
});
