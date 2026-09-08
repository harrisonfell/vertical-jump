import { describe, expect, it } from 'vitest';
import { RULESET_V1 } from '@vert/engine';
import { lbToKg } from '@vert/engine/units';
import { buildAsymmetry, signedPct, sideWord } from './asymmetry';
import { buildPullUp, pullUpTrendCaption } from './pullUp';
import { buildReadinessGate, divergenceLine } from './readinessGate';
import { buildProgressModel } from './select';
import {
  FIXTURE_START,
  FIXTURE_TODAY,
  fixtureAthlete,
  fixtureLiftSet,
  fixtureReadinessTest,
  fixtureRecovery,
  fixtureSingleLeg,
  fixtureSources,
  fixtureWeek,
} from './fixtureRows';
import { addDays } from '../../ui/charts/scale';

const RULESET = RULESET_V1;
const WEEKS = [1, 2, 3, 4, 5, 6, 7].map((w) => fixtureWeek(w));

/** The Monday of week `w`, which is where a pull-up set is logged. */
function weekDay(w: number, offset = 1): string {
  return addDays(FIXTURE_START, (w - 1) * 7 + offset);
}

describe('pull-up strength', () => {
  it('trends the added-load max a week, from the engine Epley off the top set', () => {
    const model = buildPullUp({
      liftSets: [
        fixtureLiftSet({ localDate: weekDay(1), loadKg: lbToKg(25), repsDone: 5 }),
        fixtureLiftSet({ localDate: weekDay(3), loadKg: lbToKg(35), repsDone: 5 }),
        fixtureLiftSet({ localDate: weekDay(5), loadKg: lbToKg(45), repsDone: 3 }),
      ],
      weeks: WEEKS,
      workingMax: {},
      ruleset: RULESET,
    });
    expect(model).not.toBeNull();
    expect(model?.name).toBe('Weighted pull-up');
    // 25 x 5 -> 25 x (1 + 5/30) x 0.95 = 27.7 lb, on the 5 lb grid; 45 x 3
    // -> 47.0 lb, which rounds back down to 45.
    expect(model?.trend.map((point) => point.label)).toEqual(['30 lb', '40 lb', '45 lb']);
    expect(model?.trend.map((point) => point.weekLabel)).toEqual(['Wk 1', 'Wk 3', 'Wk 5']);
    expect(model?.trend[1]?.fromLabel).toBe('5 × BW + 35 lb');
  });

  it('leaves a week with no logged set as a gap rather than repeating the last one', () => {
    const model = buildPullUp({
      liftSets: [fixtureLiftSet({ localDate: weekDay(2), loadKg: lbToKg(35), repsDone: 5 })],
      weeks: WEEKS,
      workingMax: {},
      ruleset: RULESET,
    });
    expect(model?.trend).toHaveLength(1);
    expect(model?.trendCaption).toBe('One week on file (40 lb). A line needs a second week.');
  });

  it('reads the max as added load and says where it came from', () => {
    const model = buildPullUp({
      liftSets: [fixtureLiftSet({ localDate: weekDay(1) })],
      weeks: WEEKS,
      workingMax: {
        weighted_pull_up: {
          exerciseId: 'weighted_pull_up',
          valueKg: lbToKg(40),
          source: 'entered',
          confidence: 1,
          frozenAt: '2026-09-08T12:00:00.000Z',
          lastRaiseAt: null,
        },
      },
      ruleset: RULESET,
    });
    expect(model?.workingMaxLb).toBe('40 lb added');
    expect(model?.sourceLine).toBe('entered 40 lb added, 8 Sep');
    expect(model?.topSets[0]?.setLabel).toBe('5 × BW + 35 lb');
  });

  it('says the correlate sentence once, verbatim', () => {
    const model = buildPullUp({
      liftSets: [fixtureLiftSet({ localDate: weekDay(1) })],
      weeks: WEEKS,
      workingMax: {},
      ruleset: RULESET,
    });
    expect(model?.correlateLine).toBe(
      'Pull-up strength tracks wall time more closely than any other measure.',
    );
  });

  it('is absent before a weighted pull-up set exists, and ignores an unloaded pull-up', () => {
    expect(buildPullUp({ liftSets: [], weeks: WEEKS, workingMax: {}, ruleset: RULESET })).toBeNull();
    const bodyweightOnly = buildPullUp({
      liftSets: [
        fixtureLiftSet({ exerciseId: 'pull_up', exerciseName: 'Pull-up', localDate: weekDay(1) }),
      ],
      weeks: WEEKS,
      workingMax: {},
      ruleset: RULESET,
    });
    expect(bodyweightOnly).toBeNull();
  });

  it('names a drop when the top set falls by R97 magnitude', () => {
    const model = buildPullUp({
      liftSets: [
        fixtureLiftSet({ localDate: weekDay(1), loadKg: lbToKg(50), repsDone: 5 }),
        fixtureLiftSet({ localDate: weekDay(2), loadKg: lbToKg(45), repsDone: 5 }),
      ],
      weeks: WEEKS,
      workingMax: {},
      ruleset: RULESET,
    });
    expect(model?.dropLine).toBe('Loads −10% after missed reps · 15 Sep');
  });

  it('says how far the line moved once there are two weeks', () => {
    expect(
      pullUpTrendCaption([
        { w: 1, weekLabel: 'Wk 1', date: '2026-09-08', dateLabel: '8 Sep', addedLb: 30, label: '30 lb', fromLabel: '5 × BW + 25 lb' },
        { w: 5, weekLabel: 'Wk 5', date: '2026-10-06', dateLabel: '6 Oct', addedLb: 50, label: '50 lb', fromLabel: '3 × BW + 45 lb' },
      ]),
    ).toBe('2 weeks · 30 lb to 50 lb · +20 lb');
  });
});

describe('asymmetry copy thresholds', () => {
  const band = RULESET.constants.climbing.asymmetryBandPct;

  it('reads a gap under 5 percent as balanced and names no side', () => {
    const model = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-10-13', 19.0, 19.6)],
      answer: null,
      bandPct: band,
    });
    expect(model?.rows[0]?.band).toBe('balanced');
    expect(model?.rows[0]?.weakerSide).toBe('Level');
    expect(model?.note).toBe(
      'Inside the band. Neither leg leads on unilateral work for a gap this size.',
    );
  });

  it('reads 5 to 10 percent as worth watching and names the weaker leg', () => {
    const model = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-10-13', 17.9, 19.2)],
      answer: null,
      bandPct: band,
    });
    expect(model?.rows[0]?.band).toBe('watch');
    expect(model?.rows[0]?.pct).toBe('−7%');
    expect(model?.rows[0]?.weakerSide).toBe('Left');
    expect(model?.note).toBe(
      'Worth watching. The left leg goes first on unilateral work while the gap holds.',
    );
    expect(model?.orderLine).toBe('Left leg first on every unilateral set.');
  });

  it('reads over 10 percent as wide enough to work on', () => {
    const model = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-10-13', 16.5, 19.2)],
      answer: null,
      bandPct: band,
    });
    expect(model?.rows[0]?.band).toBe('flag');
    expect(model?.note).toBe(
      'Wide enough to work on. The left leg goes first on unilateral work, every set.',
    );
  });

  it('carries the three bands as one legend sentence', () => {
    const model = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-10-13', 17.9, 19.2)],
      answer: null,
      bandPct: band,
    });
    expect(model?.legend).toBe(
      'Under 5% balanced. 5 to 10% worth watching. Over 10% wide enough to work on.',
    );
  });

  it('holds the direction back until two tests exist', () => {
    const one = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-09-15', 17.2, 18.9)],
      answer: null,
      bandPct: band,
    });
    expect(one?.trendLine).toBeNull();

    const two = buildAsymmetry({
      tests: [
        fixtureSingleLeg('2026-09-15', 17.2, 18.9),
        fixtureSingleLeg('2026-10-13', 17.9, 19.2),
      ],
      answer: null,
      bandPct: band,
    });
    expect(two?.trendLine).toBe('Gap 9% at the first test, 7% now, across 2 tests. Narrowing.');
    expect(two?.rows[0]?.dateLabel).toBe('13 Oct');
  });

  it('is absent until one single-leg test exists', () => {
    expect(buildAsymmetry({ tests: [], answer: 'left', bandPct: band })).toBeNull();
  });

  it('reports what the legs said on unilateral work logged per side', () => {
    // Single-leg RDLs at 30, 35 and 40 lb: the right leg never past RPE 6 and
    // the left up at 8. The test day was level, so the logs name the leg.
    const rdl = [30, 35, 40].flatMap((lb, index) => [
      fixtureLiftSet({
        exerciseId: 'single_leg_rdl',
        sessionId: 'session-1-1',
        setNumber: index + 1,
        repsDone: 8,
        loadKg: lbToKg(lb),
        rpe: 8,
        side: 'left',
      }),
      fixtureLiftSet({
        exerciseId: 'single_leg_rdl',
        sessionId: 'session-1-1',
        setNumber: index + 1,
        repsDone: 8,
        loadKg: lbToKg(lb),
        rpe: 6,
        side: 'right',
      }),
    ]);

    const model = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-10-13', 19.0, 19.6)],
      answer: null,
      bandPct: band,
      liftSets: rdl,
    });
    expect(model?.effortLine).toBe(
      'Left RPE 8, right RPE 6 at the same loads. The left leg is working harder, so it goes first.',
    );
    // The test was inside the band, so the logs decide the ordering.
    expect(model?.weakerSide).toBe('left');
    expect(model?.orderLine).toBe('Left leg first on every unilateral set.');
  });

  it('says nothing about effort when no set was logged per side', () => {
    const model = buildAsymmetry({
      tests: [fixtureSingleLeg('2026-10-13', 17.9, 19.2)],
      answer: null,
      bandPct: band,
      liftSets: [fixtureLiftSet()],
    });
    expect(model?.effortLine).toBeNull();
  });

  it('formats a signed whole percent and a side word', () => {
    expect(signedPct(-6.77)).toBe('−7%');
    expect(signedPct(6.77)).toBe('+7%');
    expect(signedPct(0.2)).toBe('0%');
    expect(sideWord(null)).toBe('Level');
  });
});

describe('the readiness gate section', () => {
  const config = RULESET.constants.climbing.readiness;

  /** Nine steady throws before today, so the rolling median is trusted. */
  function priorThrows(): ReturnType<typeof fixtureReadinessTest>[] {
    return [7.0, 7.2, 7.1, 7.0, 7.2, 7.1, 7.1, 7.2, 7.0].map((best, index) =>
      fixtureReadinessTest(addDays(FIXTURE_TODAY, -(9 - index) * 2), best),
    );
  }

  it('keeps the two channels apart and marks the days they disagree', () => {
    const tests = [...priorThrows(), fixtureReadinessTest(FIXTURE_TODAY, 7.15)];
    const model = buildReadinessGate({
      today: FIXTURE_TODAY,
      config,
      tests,
      recovery: [
        fixtureRecovery(addDays(FIXTURE_TODAY, -2), 30),
        fixtureRecovery(FIXTURE_TODAY, 73),
      ],
      ruleset: RULESET,
    });
    expect(model).not.toBeNull();
    const today = model?.days.find((day) => day.date === FIXTURE_TODAY);
    expect(today?.autonomic).toBe('high');
    expect(today?.neuromuscular).toBe('high');
    expect(today?.state).toBe('both_high');
    expect(today?.testValue).toBe('7.2 m');
    expect(today?.diverged).toBe(false);

    const low = model?.days.find((day) => day.date === addDays(FIXTURE_TODAY, -2));
    expect(low?.autonomic).toBe('low');
    expect(low?.neuromuscular).toBe('high');
    expect(low?.state).toBe('autonomic_low');
    expect(low?.diverged).toBe(true);
    expect(model?.divergenceCount).toBe(1);
  });

  it('reads a throw more than 5 percent under the median as neuromuscular low', () => {
    const tests = [...priorThrows(), fixtureReadinessTest(FIXTURE_TODAY, 6.4)];
    const model = buildReadinessGate({
      today: FIXTURE_TODAY,
      config,
      tests,
      recovery: [fixtureRecovery(FIXTURE_TODAY, 73)],
      ruleset: RULESET,
    });
    const today = model?.days.find((day) => day.date === FIXTURE_TODAY);
    expect(today?.state).toBe('neuromuscular_low');
    expect(today?.diverged).toBe(true);
    expect(model?.todayLine).toContain('neuromuscular low');
  });

  it('treats a pending morning as no reading rather than as a low one', () => {
    const model = buildReadinessGate({
      today: FIXTURE_TODAY,
      config,
      tests: [],
      recovery: [fixtureRecovery(FIXTURE_TODAY, null)],
      ruleset: RULESET,
    });
    const today = model?.days[0];
    expect(today?.autonomic).toBe('unknown');
    expect(today?.recoveryScore).toBeNull();
    expect(today?.state).toBe('unknown');
    expect(today?.diverged).toBe(false);
  });

  it('spells the four readings out in words with the ruleset magnitudes', () => {
    const model = buildReadinessGate({
      today: FIXTURE_TODAY,
      config,
      tests: [],
      recovery: [fixtureRecovery(FIXTURE_TODAY, 73)],
      ruleset: RULESET,
    });
    expect(model?.legend.map((item) => item.state)).toEqual([
      'both_high',
      'autonomic_low',
      'neuromuscular_low',
      'both_low',
    ]);
    expect(model?.legend[0]?.line).toBe('Autonomic fine, neuromuscular fine: session as written.');
    expect(model?.legend[1]?.line).toBe(
      'Autonomic low, neuromuscular fine: session as written, volume held.',
    );
    expect(model?.legend[2]?.diverged).toBe(true);
    expect(model?.legend[3]?.line).toContain('loads down 10%');
    expect(model?.testNoun).toBe('throw');
  });

  it('is absent for an athlete with neither channel on file', () => {
    expect(
      buildReadinessGate({
        today: FIXTURE_TODAY,
        config,
        tests: [],
        recovery: [],
        ruleset: RULESET,
      }),
    ).toBeNull();
  });

  it('counts divergence days rather than averaging the two channels', () => {
    expect(divergenceLine(0, 21)).toBe(
      'No divergence days in 21 scored days. The two channels agreed every time.',
    );
    expect(divergenceLine(3, 21)).toBe(
      '3 divergence days in 21 scored days. Divergence is the signal, not the average.',
    );
  });
});

describe('the whole model', () => {
  it('keeps a single-leg pair out of the ledger and out of the jump stream', () => {
    const sources = fixtureSources({
      singleLegTests: [fixtureSingleLeg('2026-10-13', 17.9, 19.2)],
    });
    const model = buildProgressModel(sources);
    expect(model.ledger.every((row) => row.mode !== 'single_leg')).toBe(true);
    expect(model.asymmetry?.rows).toHaveLength(1);
    expect(model.headline.valueIn).toBe('32.5');
  });

  it('leaves all three sections absent for an athlete with none of the streams', () => {
    const model = buildProgressModel(fixtureSources());
    expect(model.pullUp).toBeNull();
    expect(model.asymmetry).toBeNull();
    expect(model.readinessGate).toBeNull();
  });

  it('builds the three sections when the climbing streams are on file', () => {
    const model = buildProgressModel(
      fixtureSources({
        athlete: fixtureAthlete({ weakerSide: 'left' }),
        liftSets: [fixtureLiftSet({ localDate: weekDay(1) }), fixtureLiftSet({ localDate: weekDay(3) })],
        singleLegTests: [fixtureSingleLeg('2026-10-13', 17.9, 19.2)],
        readinessTests: [fixtureReadinessTest(FIXTURE_TODAY, 7.15)],
        recovery: [fixtureRecovery(FIXTURE_TODAY, 73)],
      }),
    );
    expect(model.pullUp?.trend).toHaveLength(2);
    expect(model.asymmetry?.weakerSide).toBe('left');
    expect(model.readinessGate?.days).toHaveLength(1);
  });
});
