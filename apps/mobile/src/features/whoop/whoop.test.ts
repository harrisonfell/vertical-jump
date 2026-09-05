import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  matchWindow,
  matchWorkout,
  overlapSeconds,
  rankCandidates,
  showsStrengthTrainerHint,
  sportRank,
  WINDOW_PAD_MS,
  type MatchSession,
  type MatchWorkout,
} from './match';
import { bandFor, bandWord, describeModifier, evaluateShadow, modifierFor, shadowLine } from './shadow';
import { buildGateInput, evaluateGate, weekKey } from './gateInputs';
import {
  connectedLine,
  cooldownRemainingMs,
  errorLine,
  gateCriterionLine,
  headlineFor,
  importingLine,
  syncLabel,
} from './copy';
import { createFixtureClient, readStatus, serverUrl } from './client';
import { NO_SERVER_ACTION_CAPTION } from './copy';

const session: MatchSession = {
  id: 's1',
  startedAt: '2026-10-22T17:00:00.000Z',
  markedCompleteAt: '2026-10-22T18:00:00.000Z',
  lastSetAt: '2026-10-22T17:55:00.000Z',
};

const workout = (over: Partial<MatchWorkout>): MatchWorkout => ({
  id: 'w1',
  startAt: '2026-10-22T17:05:00.000Z',
  endAt: '2026-10-22T17:58:00.000Z',
  sportName: 'strength trainer',
  ...over,
});

describe('matching a Whoop workout', () => {
  it('pads the window by 30 minutes either side', () => {
    const window = matchWindow(session);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(window.fromMs).toBe(Date.parse('2026-10-22T17:00:00.000Z') - WINDOW_PAD_MS);
    expect(window.toMs).toBe(Date.parse('2026-10-22T18:00:00.000Z') + WINDOW_PAD_MS);
  });

  it('uses the last logged set when the session was never finished', () => {
    const window = matchWindow({ ...session, markedCompleteAt: null });
    expect(window?.toMs).toBe(Date.parse('2026-10-22T17:55:00.000Z') + WINDOW_PAD_MS);
  });

  it('has no window at all when the session was never started', () => {
    expect(matchWindow({ ...session, startedAt: null })).toBeNull();
    expect(matchWorkout({ ...session, startedAt: null }, [workout({})])).toBeNull();
  });

  it('counts overlap in seconds and ignores a workout that misses', () => {
    const window = matchWindow(session);
    if (window === null) throw new Error('no window');
    expect(overlapSeconds(workout({}), window)).toBe(53 * 60);
    expect(overlapSeconds(workout({ startAt: '2026-10-23T09:00:00.000Z', endAt: '2026-10-23T10:00:00.000Z' }), window)).toBe(0);
  });

  it('picks the workout with the most overlap', () => {
    const best = matchWorkout(session, [
      workout({ id: 'small', startAt: '2026-10-22T17:50:00.000Z', endAt: '2026-10-22T18:00:00.000Z' }),
      workout({ id: 'big' }),
    ]);
    expect(best?.workout.id).toBe('big');
  });

  it('breaks an overlap tie on the sport allowlist', () => {
    const best = matchWorkout(session, [
      workout({ id: 'walk', sportName: 'Walking' }),
      workout({ id: 'lift', sportName: 'Strength Trainer' }),
    ]);
    expect(best?.workout.id).toBe('lift');
    expect(sportRank('Walking')).toBeGreaterThan(sportRank('strength trainer'));
    expect(sportRank(null)).toBeGreaterThan(sportRank('other'));
  });

  it('breaks a remaining tie on start proximity', () => {
    const near = workout({ id: 'near', startAt: '2026-10-22T17:05:00.000Z', endAt: '2026-10-22T17:35:00.000Z' });
    const far = workout({ id: 'far', startAt: '2026-10-22T17:25:00.000Z', endAt: '2026-10-22T17:55:00.000Z' });
    const ranked = rankCandidates(session, [far, near]);
    expect(ranked[0]?.workout.id).toBe('near');
  });

  it('treats an unscored workout with no end as instantaneous', () => {
    const window = matchWindow(session);
    if (window === null) throw new Error('no window');
    expect(overlapSeconds(workout({ endAt: null }), window)).toBe(0);
  });

  it('carries the Strength Trainer hint for the first three sessions', () => {
    expect(showsStrengthTrainerHint(0)).toBe(true);
    expect(showsStrengthTrainerHint(2)).toBe(true);
    expect(showsStrengthTrainerHint(3)).toBe(false);
  });
});

describe('the shadow modifier', () => {
  const base = {
    connected: true,
    scoreState: 'SCORED' as const,
    userCalibrating: false,
    recoveryScore: 70,
    baselineDays: 40,
    recoveryP33: null,
    recoveryP66: null,
  };

  it('refuses to guess without data, naming the reason', () => {
    expect(evaluateShadow({ ...base, connected: false }).reason).toBe('disconnected');
    expect(evaluateShadow({ ...base, userCalibrating: true }).reason).toBe('calibrating');
    expect(evaluateShadow({ ...base, scoreState: 'PENDING_SCORE' }).reason).toBe('not_scored');
    expect(evaluateShadow({ ...base, baselineDays: 12 }).reason).toBe('baseline_short');
  });

  it('uses Whoop bands until the owner has 28 days of their own', () => {
    expect(bandFor(70, null, null)).toEqual({ band: 'green', source: 'whoop_bands' });
    expect(bandFor(70, 45, 75)).toEqual({ band: 'yellow', source: 'own_percentiles' });
    expect(bandFor(30, 45, 75)).toEqual({ band: 'red', source: 'own_percentiles' });
  });

  it('never raises anything', () => {
    for (const band of ['green', 'yellow', 'red'] as const) {
      const modifier = modifierFor(band, false);
      expect(modifier.loadFactor).toBeLessThanOrEqual(1);
      expect(modifier.plyoVolumeFactor).toBeLessThanOrEqual(1);
      expect(modifier.tierDelta).toBeLessThanOrEqual(0);
      expect(modifier.strengthSetsDelta).toBeLessThanOrEqual(0);
    }
  });

  it('defers the test only on a Low-recovery test day', () => {
    expect(modifierFor('red', true).deferTest).toBe(true);
    expect(modifierFor('red', false).deferTest).toBe(false);
    expect(modifierFor('yellow', true).deferTest).toBe(false);
  });

  it('says what it would have done, and that it did not', () => {
    const evaluation = evaluateShadow({ ...base, recoveryScore: 28, isTestDay: true });
    expect(evaluation.available).toBe(true);
    expect(evaluation.line).toContain('Low');
    expect(evaluation.line.endsWith('Not applied.')).toBe(true);
    expect(describeModifier(modifierFor('green', false))).toEqual([]);
    expect(shadowLine(85, modifierFor('green', false))).toBe(
      'Recovery 85% High · would change nothing. Not applied.',
    );
    // Whoop's own band words, never a second vocabulary (defect COPY-11).
    expect(bandWord('green')).toBe('High');
    expect(bandWord('yellow')).toBe('Moderate');
    expect(bandWord('red')).toBe('Low');
  });
});

describe('the autoregulation gate', () => {
  const day = (n: number): string => `2026-09-${String(n).padStart(2, '0')}`;

  it('counts only scored, non-calibrating days', () => {
    const input = buildGateInput({
      recoveries: [
        { localDate: day(1), scoreState: 'SCORED', userCalibrating: false, recoveryScore: 60 },
        { localDate: day(2), scoreState: 'SCORED', userCalibrating: true, recoveryScore: 60 },
        { localDate: day(3), scoreState: 'PENDING_SCORE', userCalibrating: false, recoveryScore: null },
      ],
      sessionDays: [day(1)],
      tests: [],
      shadowBands: [],
    });
    expect(input.scoredNonCalibratingDays).toBe(1);
    expect(input.pairedDays).toBe(1);
    expect(input.pairedWeeks).toBe(1);
  });

  it('buckets paired days into Monday-start weeks', () => {
    expect(weekKey('2026-09-07')).toBe('2026-09-07');
    expect(weekKey('2026-09-13')).toBe('2026-09-07');
    expect(weekKey('2026-09-14')).toBe('2026-09-14');
  });

  it('pairs same-day recovery with canonical test height and splits the bands', () => {
    const input = buildGateInput({
      recoveries: [
        { localDate: day(5), scoreState: 'SCORED', userCalibrating: false, recoveryScore: 80 },
        { localDate: day(12), scoreState: 'SCORED', userCalibrating: false, recoveryScore: 30 },
      ],
      sessionDays: [day(5), day(12)],
      tests: [
        { localDate: day(5), bestHeightMm: 825.5, canonical: true },
        { localDate: day(12), bestHeightMm: 800.1, canonical: true },
        { localDate: day(13), bestHeightMm: 700, canonical: false },
      ],
      shadowBands: [
        { localDate: day(5), band: 'green' },
        { localDate: day(12), band: 'red' },
      ],
    });
    expect(input.canonicalTests).toBe(2);
    expect(input.pairs).toHaveLength(2);
    expect(input.greenBandTestsIn).toHaveLength(1);
    expect(input.redBandTestsIn).toHaveLength(1);
  });

  it('is not eligible on an empty store, and says so in the brief’s words', () => {
    const result = evaluateGate({ recoveries: [], sessionDays: [], tests: [], shadowBands: [] });
    expect(result.eligible).toBe(false);
    expect(result.relationship.line).toBe('Not enough tests to check (0 of 20)');
    expect(result.criteria).toHaveLength(5);
    expect(result.criteria[0]?.line).toBe('28 scored days (0 of 28)');
  });

  it('reads a criterion count first and the requirement in parentheses', () => {
    // Defect D-29: "28 scored days (86 of 28)" read as a ratio backwards.
    const result = evaluateGate({ recoveries: [], sessionDays: [], tests: [], shadowBands: [] });
    const scored = result.criteria[0];
    expect(scored === undefined ? '' : gateCriterionLine(scored)).toBe(
      '0 scored days (28 needed)',
    );
    const relationship = result.criteria[4];
    expect(relationship === undefined ? '' : gateCriterionLine(relationship)).toBe(
      result.relationship.line,
    );
  });
});

describe('Whoop copy and the fixture client', () => {
  const now = new Date('2026-10-22T13:00:00.000Z');

  it('writes the enumerated state lines', () => {
    expect(importingLine(40, 90)).toBe('Importing 90 days · 40/90');
    expect(errorLine('api_down', null, now)).toBe(
      "Whoop's API is unavailable, retrying shortly",
    );
    expect(errorLine('rate_limited', null, now)).toBe('Rate limited, next sync shortly');
  });

  it('shows the connected line with its counts', () => {
    const line = connectedLine(
      {
        status: 'connected',
        whoopUserId: 'u',
        connectedAt: null,
        lastSyncAt: '2026-10-22T13:41:00.000Z',
        backfillDaysDone: 88,
        backfillDaysTotal: 90,
        lastError: null,
        nextRetryAt: null,
      },
      now,
    );
    expect(line.startsWith('Connected · ')).toBe(true);
    expect(line.endsWith('88 days imported')).toBe(true);
  });

  it('leads with the no-server sentence when there is no server', () => {
    expect(serverUrl()).toBeNull();
    const status = readStatus({});
    expect(headlineFor(status, false, now)).toContain('sync server');
  });

  it('reads a hostile status payload without throwing', () => {
    const status = readStatus({ status: 'nonsense', backfillDaysDone: 'many', lastError: 'weird' });
    expect(status.status).toBe('disconnected');
    expect(status.backfillDaysDone).toBe(0);
    expect(status.lastError).toBeNull();
  });

  it('walks the fixture backfill one resumable chunk at a time', async () => {
    const client = createFixtureClient({ state: 'importing', daysDone: 40, now: now.toISOString() });
    const first = await client.sync();
    expect(first.daysImported).toBe(10);
    expect(first.backfillDaysDone).toBe(50);
    expect(first.status).toBe('importing');
    const status = await client.status();
    expect(status.backfillDaysDone).toBe(50);
  });

  it('simulates the two API failures', async () => {
    const client = createFixtureClient({ state: 'rate_limited' });
    await expect(client.sync()).rejects.toThrow();
    const status = await client.status();
    expect(status.status).toBe('error');
    expect(status.lastError).toBe('rate_limited');
  });

  it('disables Sync now for a minute and counts down', () => {
    expect(cooldownRemainingMs(null, 1000)).toBe(0);
    expect(cooldownRemainingMs(1000, 1000)).toBe(60_000);
    expect(syncLabel(0)).toBe('Sync now');
    expect(syncLabel(41_200)).toBe('Sync now (42 s)');
  });
});

/**
 * Defect D-28: with no sync server the screen said Whoop needs one and then
 * offered Connect, Sync now and Disconnect as live buttons. Every action on
 * the Connection section is gated on `configured` and the caption says when
 * they come back. Read from the source because the assertion is about the JSX
 * the screen ships, not about a value a pure function returns.
 */
describe('Whoop actions with no sync server', () => {
  const source = readFileSync(fileURLToPath(new URL('./whoopScreen.tsx', import.meta.url)), 'utf8');
  const connection = source.slice(
    source.indexOf('<SettingSection title="Connection"'),
    source.indexOf('title="Strain logging"'),
  );

  it('gates every action button on a configured server', () => {
    const buttons = connection.match(/<Button[\s\S]*?\/>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toContain('disabled={!configured');
  });

  it('says when the actions come back', () => {
    expect(connection).toContain('NO_SERVER_ACTION_CAPTION');
    expect(NO_SERVER_ACTION_CAPTION).toBe('Available once the review server is set up.');
  });

  it('shows the days-imported row only once days exist', () => {
    expect(connection).toContain('daysImported > 0');
  });
});
