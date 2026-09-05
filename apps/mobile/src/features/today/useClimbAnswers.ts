import { useCallback, useState } from 'react';
import { RULESET_V1, scoreReadiness } from '@vert/engine';
import type { Json } from '@/data';
import {
  useLogReadinessTest,
  useReadinessToday,
  useSetFingerPain,
  useSetKvValue,
  useSetReadinessOutcome,
} from '@/data';
import { readinessSkipKey } from './cards';
import { bestOf, testUnit, toEngineTest, toEngineTests, whoopChannel } from './readinessModel';
import type { TodayData } from './useTodayData';

/**
 * The two questions the climbing house rules ask before the first set, and
 * every write they make.
 *
 * The readiness throw is three writes in one gesture, in one order that
 * matters: the test row first, because it is the fact; then the gate's answer,
 * scored by the engine from that row and the day's recovery, because it is
 * what the fact means; then the declined flag cleared, because logging a throw
 * is the opposite of declining one. Nothing re-materialises the week: the
 * session is derived from its snapshot plus the outcome every render, which is
 * what lets a changed throw undo the adjustment and re-apply it
 * (`house.sc.readiness_gate`).
 *
 * The finger answer is one write. It is keyed by day rather than by session,
 * because the answer is about the fingers (`house.sc.finger_pain_ceiling`).
 */

export interface ClimbAnswers {
  readonly saving: boolean;
  /** Names the cause and the fix. The typed attempts are never cleared. */
  readonly saveError: string | null;
  saveThrow(attempts: readonly number[]): void;
  skipThrow(): void;
  answerFinger(value: number): void;
  skipFinger(): void;
}

const SAVE_FAILED = "Couldn't save that. Check your connection, then save again.";

export function useClimbAnswers(data: TodayData): ClimbAnswers {
  const { readinessConfig: config, session, today } = data;
  const day = useReadinessToday(config?.kind ?? 'seated_mb_throw');
  const logTest = useLogReadinessTest();
  const setOutcome = useSetReadinessOutcome();
  const setFinger = useSetFingerPain();
  const setKv = useSetKvValue();
  const [saveError, setSaveError] = useState<string | null>(null);

  const history = day.data?.history ?? [];
  const whoop = day.data?.whoop ?? null;

  const saveThrow = useCallback(
    (attempts: readonly number[]) => {
      if (config === null || session === null) return;
      const best = bestOf(attempts);
      if (best === null) return;
      setSaveError(null);
      logTest.mutate(
        {
          localDate: today,
          kind: config.kind,
          metric: config.metric,
          attempts,
          unit: testUnit(config),
          best,
        },
        {
          onSuccess: (saved) => {
            const outcome = scoreReadiness(
              config,
              whoopChannel(whoop),
              toEngineTest(saved),
              toEngineTests(history),
              RULESET_V1,
            );
            setOutcome.mutate({
              sessionId: session.id,
              localDate: today,
              state: outcome.state,
              channels: outcome.channels as unknown as Json,
              adjustment: outcome.adjustment as unknown as Json,
              line: outcome.line,
              houseRuleId: outcome.houseRuleId,
            });
            setKv.mutate({ key: readinessSkipKey(session.id), value: null });
          },
          onError: () => setSaveError(SAVE_FAILED),
        },
      );
    },
    [config, history, logTest, session, setKv, setOutcome, today, whoop],
  );

  const skipThrow = useCallback(() => {
    if (session === null) return;
    setSaveError(null);
    setKv.mutate({ key: readinessSkipKey(session.id), value: today });
  }, [session, setKv, today]);

  const answerFinger = useCallback(
    (value: number) => {
      setFinger.mutate({
        localDate: today,
        kind: 'finger_pain',
        value,
        sessionId: session?.id ?? null,
      });
    },
    [session?.id, setFinger, today],
  );

  const skipFinger = useCallback(() => {
    setFinger.mutate({
      localDate: today,
      kind: 'finger_pain',
      value: null,
      sessionId: session?.id ?? null,
    });
  }, [session?.id, setFinger, today]);

  return {
    saving: logTest.isPending || setOutcome.isPending,
    saveError,
    saveThrow,
    skipThrow,
    answerFinger,
    skipFinger,
  };
}
