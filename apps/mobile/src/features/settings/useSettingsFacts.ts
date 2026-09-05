import { useMemo } from 'react';
import type { analytics } from '@vert/engine';
import {
  useAutoregulationStatus,
  useSessionsBetween,
  useTests,
  useToday,
  useTodayRecovery,
  useWhoopConnection,
  useWhoopRecoveryDays,
  type Athlete,
  type PainStatus,
} from '@/data';
import { addDays } from '@/lib/localDay';
// Straight at the three modules rather than at the Whoop barrel, which also
// exports the Whoop screen and would close a require cycle back into Settings.
import { AUTOREGULATION_PAUSED_LINE } from '../whoop/copy';
import { evaluateGate } from '../whoop/gateInputs';
import { evaluateShadow, type ShadowEvaluation } from '../whoop/shadow';
import type { LiftSource } from './lifts';

/**
 * The numbers the Settings screen shows that are not simply fields.
 *
 * Every one of them is derived: the gate from what the store has counted, the
 * shadow line from today's recovery, and the lift rows from the working maxes
 * the engine froze. Nothing here writes, and nothing here invents a value when
 * the data is missing: an absent number stays absent.
 */

/** Ninety days is what the gate counts over, so that is the window read. */
const GATE_WINDOW_DAYS = 90;

export interface SettingsFacts {
  readonly gate: analytics.GateResult;
  readonly shadow: ShadowEvaluation;
  readonly autoregulationEnabled: boolean;
  readonly pausedReason: string | null;
  readonly lifts: readonly LiftSource[];
}

export function useSettingsFacts(
  athlete: Athlete | null,
  pain: readonly PainStatus[],
): SettingsFacts {
  void pain;
  const today = useToday();
  const recoveryQuery = useWhoopRecoveryDays(GATE_WINDOW_DAYS);
  const todayRecovery = useTodayRecovery();
  const connectionQuery = useWhoopConnection();
  const statusQuery = useAutoregulationStatus();
  const testsQuery = useTests('ovr_jump_regular');
  const sessionsQuery = useSessionsBetween(addDays(today, -GATE_WINDOW_DAYS), today);

  const gate = useMemo(
    () =>
      evaluateGate({
        recoveries: (recoveryQuery.data ?? []).map((day) => ({
          localDate: day.localDate,
          scoreState: day.scoreState,
          userCalibrating: day.userCalibrating,
          recoveryScore: day.recoveryScore,
        })),
        sessionDays: (sessionsQuery.data ?? [])
          .filter((session) => session.loggedSetCount > 0)
          .map((session) => session.scheduledDate),
        tests: (testsQuery.data ?? []).map((test) => ({
          localDate: test.localDate,
          bestHeightMm: test.bestHeightMm,
          canonical: test.canonical,
        })),
        // Shadow bands are logged per day by the readiness job, which lands
        // with the daily sync. Until then the band criterion reads as unchecked
        // rather than as a relationship nobody measured.
        shadowBands: [],
      }),
    [recoveryQuery.data, sessionsQuery.data, testsQuery.data],
  );

  const scoredDays = gate.criteria.find((entry) => entry.id === 'scored_days')?.count ?? 0;
  const connection = connectionQuery.data ?? null;
  const recovery = todayRecovery.data ?? null;

  const shadow = useMemo(
    () =>
      evaluateShadow({
        connected: connection?.status === 'connected',
        scoreState: recovery?.scoreState ?? null,
        userCalibrating: recovery?.userCalibrating ?? false,
        recoveryScore: recovery?.recoveryScore ?? null,
        baselineDays: scoredDays,
        recoveryP33: null,
        recoveryP66: null,
      }),
    [connection?.status, recovery, scoredDays],
  );

  const status = statusQuery.data ?? null;
  const enabled = status?.enabled ?? false;
  const paused =
    enabled && connection !== null && connection.status !== 'connected'
      ? AUTOREGULATION_PAUSED_LINE
      : (status?.pausedReason ?? null);

  const lifts = useMemo<LiftSource[]>(() => {
    if (athlete === null) return [];
    return Object.entries(athlete.workingMax)
      .map(([exerciseId, max]) => ({
        exerciseId,
        name: liftName(exerciseId),
        valueKg: max.valueKg,
        source: max.source,
        confidence: max.confidence,
        // The estimate lives with the week build, which is the only place with
        // the four-week log lookback R73 needs. Absent here means absent.
        estimateKg: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [athlete]);

  return { gate, shadow, autoregulationEnabled: enabled, pausedReason: paused, lifts };
}

/** "back_squat" as "Back squat". The exercise table owns the real names. */
export function liftName(exerciseId: string): string {
  const words = exerciseId.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
