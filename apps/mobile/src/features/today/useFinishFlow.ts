import { useCallback, useState } from 'react';
import type { Adherence, LandingQuality, WeekKind } from '@vert/engine';
import { RULESET_V1, decideOutcome, outcomeLine } from '@vert/engine';
import type { SetLog, Week } from '@/data';
import {
  useAdherenceInputs,
  useFinishSession,
  usePatchSession,
  useUpsertWeek,
  useWeeks,
} from '@/data';
import { advanceLadders, type LadderState } from './finish';
import type { TodaySession } from './model';

/**
 * Finishing a session.
 *
 * Three things happen in order and none of them may be skipped: the answers go
 * on the session, the finish mark goes in as a log event, and, when this was
 * the week's last scheduled workout, the week is decided. The engine owns the
 * decision; this hook only assembles the inputs it needs from the store and
 * carries the two things the generator reads but does not itself advance:
 * the ladder rungs and the week's outcome.
 */

export interface FinishAnswers {
  readonly sorenessPre: number | null;
  readonly rpe: number | null;
  readonly legsFeel: 'fresh' | 'normal' | 'heavy' | null;
  readonly notes: string;
}

export interface FinishFlow {
  readonly saving: boolean;
  readonly error: string | null;
  /** The engine's own outcome sentence, once the week has been decided. */
  readonly outcome: string | null;
  finish(answers: FinishAnswers): Promise<void>;
}

export interface FinishFlowInput {
  readonly sessionId: string | null;
  readonly week: Week | null;
  readonly nextWeek: Week | null;
  readonly plan: TodaySession | null;
  readonly logs: readonly SetLog[];
  /** True when this is the last scheduled workout of the calendar week. */
  readonly isWeekFinalWorkout: boolean;
  readonly programId: string | null;
}

function readRungs(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') out[key] = entry;
  }
  return out;
}

/** Landings this session recorded, grouped by the ladder they belong to. */
export function landingsByLadder(
  plan: TodaySession | null,
  logs: readonly SetLog[],
): Record<string, LandingQuality[]> {
  if (plan === null) return {};
  const byExercise = new Map<string, string>();
  for (const block of plan.blocks) {
    for (const exercise of block.exercises) {
      if (exercise.ladderId !== null) byExercise.set(exercise.id, exercise.ladderId);
    }
  }

  const out: Record<string, LandingQuality[]> = {};
  for (const log of logs) {
    if (log.landing === null) continue;
    const ladderId = byExercise.get(log.sessionExerciseId);
    if (ladderId === undefined) continue;
    const bucket = out[ladderId] ?? [];
    bucket.push(log.landing);
    out[ladderId] = bucket;
  }
  return out;
}

/** The rungs each ladder has already spent inside the current block. */
export function ladderStates(
  current: Record<string, number>,
  blockStart: Record<string, number>,
): Record<string, LadderState> {
  const out: Record<string, LadderState> = {};
  for (const [ladderId, rung] of Object.entries(current)) {
    out[ladderId] = {
      rung,
      advancesThisBlock: Math.max(0, rung - (blockStart[ladderId] ?? rung)),
    };
  }
  return out;
}

export function useFinishFlow(input: FinishFlowInput): FinishFlow {
  const patch = usePatchSession();
  const finishSession = useFinishSession();
  const upsertWeek = useUpsertWeek();
  const adherence = useAdherenceInputs(input.week?.id);
  const weeks = useWeeks(input.programId ?? undefined);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const finish = useCallback(
    async (answers: FinishAnswers): Promise<void> => {
      if (input.sessionId === null) return;
      setSaving(true);
      setError(null);

      try {
        await patch.mutateAsync({
          sessionId: input.sessionId,
          patch: {
            sorenessPre: answers.sorenessPre,
            rpe: answers.rpe,
            legsFeel: answers.legsFeel,
            notes: answers.notes === '' ? null : answers.notes,
          },
        });
        await finishSession.mutateAsync(input.sessionId);

        if (!input.isWeekFinalWorkout || input.week === null) {
          setSaving(false);
          return;
        }

        const week = input.week;
        const inputs = adherence.data;
        const prescribed = inputs?.prescribedCount ?? week.prescribedCount;
        // The session just marked complete is not in the cached count yet.
        const completed = Math.min(prescribed, (inputs?.completedCount ?? 0) + 1);
        const decided: Adherence = {
          prescribed,
          completed,
          pct: prescribed === 0 ? 0 : completed / prescribed,
          allRepsCompleted: inputs?.allRepsCompleted ?? true,
          perLiftFailures: {},
        };

        const history = (weeks.data ?? [])
          .filter((entry) => entry.w < week.w && entry.adherencePct !== null)
          .sort((a, b) => a.w - b.w)
          .map((entry) => entry.adherencePct ?? 0);

        const decision = decideOutcome(
          decided,
          decided.allRepsCompleted,
          history,
          RULESET_V1,
        );
        setOutcome(outcomeLine(week.w, decided, decision));

        // The generator reads ladder rungs; the caller advances them. One rung
        // per load week on Good or OK landings, at most two inside a block.
        if (input.nextWeek !== null && input.programId !== null) {
          const blockStartWeek = (weeks.data ?? [])
            .filter((entry) => entry.blockId === week.blockId)
            .sort((a, b) => a.w - b.w)[0];
          const advanced = advanceLadders(
            ladderStates(readRungs(week.ladderRungs), readRungs(blockStartWeek?.ladderRungs)),
            decision.allowLadderAdvance ? landingsByLadder(input.plan, input.logs) : {},
            week.kind as WeekKind,
          );
          const rungs: Record<string, number> = {};
          for (const [ladderId, state] of Object.entries(advanced)) rungs[ladderId] = state.rung;

          await upsertWeek.mutateAsync({
            programId: input.programId,
            w: input.nextWeek.w,
            windowStart: input.nextWeek.windowStart,
            windowEnd: input.nextWeek.windowEnd,
            kind: input.nextWeek.kind,
            k: input.nextWeek.k,
            blockId: input.nextWeek.blockId,
            prescribedCount: input.nextWeek.prescribedCount,
            ladderRungs: rungs,
            snapshot: input.nextWeek.snapshot,
          });
        }
      } catch {
        setError("Couldn't finish the session. Your sets are saved. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [adherence.data, finishSession, input, patch, upsertWeek, weeks.data],
  );

  return { saving, error, outcome, finish };
}
