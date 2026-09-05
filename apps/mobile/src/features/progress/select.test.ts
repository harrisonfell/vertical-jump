import { describe, expect, it } from 'vitest';
import { inToMm } from '@vert/engine/units';
import { prThreshold } from '@vert/engine/analytics';
import type { Json } from '@/data';
import {
  FIXTURE_HEIGHTS_IN,
  FIXTURE_START,
  FIXTURE_TARGET,
  fixtureProgram,
  fixtureSources,
  fixtureTests,
  makeTest,
} from './fixtureRows';
import { recoveryCaption } from './chartModel';
import { buildProgressModel } from './select';
import { onStream, toEngineTest } from './streams';
import { applyProgressState } from './states';
import { addDays } from '../../ui/charts/scale';

describe('the pace readout', () => {
  it('names the stream and the number the fixture week actually shows', () => {
    const model = buildProgressModel(fixtureSources());
    expect(model.instrument).toBe('ovr_jump_regular');
    expect(model.headline.valueIn).toBe('32.5');
    expect(model.headline.goalIn).toBe('36.0');
    expect(model.headline.gapIn).toBe('+3.5');
    expect(model.headline.isPr).toBe(true);
    expect(model.headline.sparkline).toHaveLength(5);
  });

  it('asks for more tests before it states a trend', () => {
    const model = buildProgressModel(
      applyProgressState(fixtureSources(), 'one-test'),
    );
    expect(model.pace?.state.kind).toBe('needs_tests');
    expect(model.paceLine).toContain('Trend needs');
    expect(model.noiseNote).toContain('the trend matters');
  });

  it('labels a short fit as an early trend and hides the projection', () => {
    const model = buildProgressModel(
      applyProgressState(fixtureSources(), 'three-tests'),
    );
    expect(model.trendCaption).toBe('Early trend · 3 tests.');
    expect(model.chart?.projection).toBeUndefined();
  });

  it('reads the goal as met and offers the card once', () => {
    const met = applyProgressState(fixtureSources(), 'goal-met');
    const model = buildProgressModel(met);
    expect(model.pace?.state.kind).toBe('goal_met');
    expect(model.card?.kind).toBe('goal_reached');
    // The projection is hidden once the goal is met: it has nothing to add.
    expect(model.chart?.projection).toBeUndefined();

    const acknowledged = buildProgressModel(
      applyProgressState(fixtureSources(), 'goal-acknowledged'),
    );
    expect(acknowledged.card).toBeNull();
  });

  it('calls five flat tests a plateau and names the remedy', () => {
    const model = buildProgressModel(applyProgressState(fixtureSources(), 'plateau'));
    expect(model.pace?.state.kind).toBe('plateau');
    expect(model.paceLine).toContain('Next block varies exercise selection');
  });

  it('says the target date has passed instead of projecting past it', () => {
    const model = buildProgressModel(applyProgressState(fixtureSources(), 'target-passed'));
    expect(model.targetPassed).toBe(true);
    expect(model.paceLine).toContain('Target date passed');
    expect(model.headline.weeksLeft).toBe('passed');
  });

  it('offers the next program the day after the target date', () => {
    const model = buildProgressModel(applyProgressState(fixtureSources(), 'program-complete'));
    expect(model.card?.kind).toBe('program_complete');
    expect(model.card?.primaryLabel).toBe('Build program 2');
  });
});

describe('the chart frame', () => {
  it('draws the frame with no tests at all and says when the first one is', () => {
    const sources = applyProgressState(fixtureSources(), 'no-tests');
    const withTestDay = {
      ...sources,
      sessions: sources.sessions.map((session, index) =>
        index === 0 ? { ...session, scheduledDate: '2026-11-14', testStatus: 'planned' as const } : session,
      ),
    };
    const model = buildProgressModel(withTestDay);
    expect(model.hasTests).toBe(false);
    expect(model.chart?.tests).toHaveLength(0);
    expect(model.chart?.emptyMessage).toBe('No tests yet. First test: Sat 14 Nov.');
    expect(model.chart?.baseline.heightIn).toBeCloseTo(29.4, 1);
    expect(model.chart?.goalIn).toBeCloseTo(36, 5);
  });

  it('carries the fixed frame from program start to the target date', () => {
    const model = buildProgressModel(fixtureSources());
    expect(model.chart?.programStart).toBe('2026-09-07');
    expect(model.chart?.targetDate).toBe(FIXTURE_TARGET);
    expect(model.chart?.trend).toHaveLength(2);
  });
});

describe('stream identity', () => {
  it('never carries a stream across an instrument change', () => {
    const model = buildProgressModel(applyProgressState(fixtureSources(), 'instrument-changed'));
    expect(model.instrument).toBe('vertec_reach_touch');
    expect(model.streamNotes[0]).toContain('Earlier OVR Jump tests stay on their own line');
  });

  it('marks a device-version change as a break rather than a new instrument', () => {
    const model = buildProgressModel(applyProgressState(fixtureSources(), 'device-changed'));
    expect(model.instrument).toBe('ovr_jump_regular');
    expect(model.streamNotes.join(' ')).toContain('OVR Connect updated to 2.1');
    expect(model.chart?.streamBreaks?.[0]?.label).toBe('OVR Connect 2.1');
  });

  it('keeps a second instrument out of the primary stream trend', () => {
    const base = fixtureSources();
    const vertec = makeTest({
      id: 'vertec-1',
      date: '2026-09-01',
      heightIn: 24,
      instrument: 'vertec_reach_touch',
      mode: 'reach_touch',
      isBaseline: false,
    });
    const model = buildProgressModel({ ...base, tests: [vertec, ...base.tests] });
    expect(model.instrument).toBe('ovr_jump_regular');
    expect(model.pace?.points).toHaveLength(FIXTURE_HEIGHTS_IN.length - 1);
    expect(model.ledger).toHaveLength(FIXTURE_HEIGHTS_IN.length + 1);
  });
});

describe('the weekly review line', () => {
  it('builds the current week from the sessions, the test, and the trend', () => {
    const model = buildProgressModel(fixtureSources());
    expect(model.reviewLine).toContain('Week 7 of 7');
    expect(model.reviewLine).toContain('4/4 (100%)');
    expect(model.reviewLine).toContain('progressed');
    expect(model.reviewLine).toContain('trend');
    expect(model.reviewLine).toContain('need');
  });

  it('drops the segments it has no data for rather than printing zeros', () => {
    const sources = fixtureSources();
    const bare = {
      ...sources,
      weeks: sources.weeks.map((week) => ({ ...week, outcome: null })),
      sessions: sources.sessions.map((session) => ({ ...session, rpe: null })),
      tests: [],
    };
    const model = buildProgressModel(bare);
    expect(model.reviewLine).not.toContain('progressed');
    expect(model.reviewLine).not.toContain('sRPE');
    expect(model.reviewLine).not.toContain('avg recovery');
  });
});

describe('the Whoop caption', () => {
  it('counts the backfill while it is running and goes quiet after', () => {
    const connecting = recoveryCaption({
      id: 'whoop',
      status: 'connecting',
      whoopUserId: null,
      scopes: null,
      connectedAt: null,
      revokedAt: null,
      lastSyncAt: null,
      backfillCursor: null,
      backfillDaysDone: 40,
      backfillDaysTotal: 90,
      lastError: null,
      nextRetryAt: null,
      updatedAt: '2026-10-22T06:41:00.000Z',
    });
    expect(connecting).toBe('Importing Whoop history · 40/90 days');
    expect(recoveryCaption(null)).toBeNull();
  });
});

describe('recovery vs output', () => {
  it('stays a counter line until one band has six sessions', () => {
    const model = buildProgressModel(fixtureSources());
    expect(model.recoveryOutput.ready).toBe(false);
    expect(model.recoveryOutput.counterLine).toContain('needs 6 sessions in one band');
  });

  it('opens once a band is full and splits the RPEs into strips', () => {
    const sources = fixtureSources();
    const recovery = sources.sessions.map((session, index) => ({
      id: `rec-${index}`,
      cycleId: null,
      sleepId: null,
      scoreState: 'SCORED' as const,
      userCalibrating: false,
      recoveryScore: 72,
      restingHeartRate: 48,
      hrvRmssdMilli: 90,
      spo2Percentage: null,
      skinTempCelsius: null,
      timezoneOffset: null,
      localDate: session.scheduledDate,
      raw: null,
      updatedAt: '2026-10-22T06:41:00.000Z',
    }));
    const model = buildProgressModel({ ...sources, recovery });
    expect(model.recoveryOutput.ready).toBe(true);
    const high = model.recoveryDots.find((band) => band.band === 'high');
    expect(high?.values.length).toBeGreaterThanOrEqual(6);
    expect(model.recoveryDots.find((band) => band.band === 'low')?.values).toHaveLength(0);
  });
});

describe('the test overrides', () => {
  it('leaves the default sources untouched', () => {
    const sources = fixtureSources();
    expect(applyProgressState(sources, 'default')).toBe(sources);
  });

  it('raises the newest test above the goal for the goal-met reading', () => {
    const raised = applyProgressState(fixtureSources(), 'goal-met');
    const newest = raised.tests[raised.tests.length - 1];
    expect(newest?.bestHeightMm ?? 0).toBeGreaterThan(inToMm(36));
  });

  it('moves today past the target date without touching the tests', () => {
    const passed = applyProgressState(fixtureSources(), 'target-passed');
    expect(passed.today).toBe(addDays(FIXTURE_TARGET, 3));
    expect(passed.tests).toHaveLength(fixtureTests().length);
  });
});

/**
 * The program's own length and its test calendar come from the skeleton the
 * program was generated with, not from the weeks materialized so far.
 */
function skeletonSnapshot(weeks: number, testDates: readonly string[]): Json {
  return {
    programStart: FIXTURE_START,
    targetDate: FIXTURE_TARGET,
    W: weeks,
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    testWeekdayIndex: 2,
    blocks: [],
    weeks: testDates.map((date, index) => ({
      w: index + 1,
      sessions: [{ dayIndex: 2, weekday: 4, date, dayType: 'Power', isTestDay: true }],
    })),
  };
}

describe('the PR threshold caption', () => {
  it('prints the reason the engine gives rather than a hand-built sentence', () => {
    const sources = fixtureSources();
    const model = buildProgressModel(sources);
    const engine = prThreshold(
      onStream(sources.tests, 'ovr_jump_regular', 'Regular').map(toEngineTest),
      'ovr_jump_regular',
      sources.ruleset,
    );
    expect(model.headline.thresholdReason).toBe(engine.reason);
    expect(model.headline.thresholdReason).toContain('your test noise');
  });
});

describe('the program week count', () => {
  it('counts the weeks the skeleton has, not the weeks built so far', () => {
    const sources = fixtureSources();
    const model = buildProgressModel({
      ...sources,
      program: fixtureProgram({ snapshot: skeletonSnapshot(12, []) }),
    });
    expect(model.reviewLine).toContain('Week 7 of 12');
    expect(model.weekRows.at(-1)?.reviewLine).toContain('Week 7 of 12');
  });

  it('falls back to the weeks on file when the snapshot cannot say', () => {
    expect(buildProgressModel(fixtureSources()).reviewLine).toContain('Week 7 of 7');
  });
});

describe('the first test date with no tests yet', () => {
  it('reads the skeleton when no built session carries the test', () => {
    const sources = applyProgressState(fixtureSources(), 'no-tests');
    const model = buildProgressModel({
      ...sources,
      program: fixtureProgram({ snapshot: skeletonSnapshot(12, ['2026-09-10', '2026-11-14']) }),
    });
    expect(model.chart?.emptyMessage).toBe('No tests yet. First test: Sat 14 Nov.');
  });
});

describe('one display number a screen', () => {
  it('hands the display size to the card and compacts the headline', () => {
    const goal = buildProgressModel(applyProgressState(fixtureSources(), 'goal-met'));
    expect(goal.card?.value).not.toBeNull();
    expect(goal.compactHeadline).toBe(true);

    const done = buildProgressModel(applyProgressState(fixtureSources(), 'program-complete'));
    // The completion card has no number of its own and never borrows one.
    expect(done.card?.value).toBeNull();
    expect(done.compactHeadline).toBe(true);
  });

  it('keeps the display size on the headline when no card is up', () => {
    expect(buildProgressModel(fixtureSources()).compactHeadline).toBe(false);
  });
});
