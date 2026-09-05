import { useState } from 'react';
import type { ReadinessTestConfig } from '@vert/engine';
import { inToMm, lbToKg } from '@vert/engine/units';
import {
  useDeleteJumpTest,
  useLogJumpTest,
  useLogReadinessTest,
  useTodayRecovery,
} from '@/data';
import { snapshotOf } from './sheetModel';
import { SINGLE_LEG_MODE, singleLegAttempts } from './singleLeg';
import { storedUnit, throwAttempts } from './throwTest';
import { draftAttempts, draftKind, throwAttemptsOf, type TestDraft } from './validate';

/**
 * The sheet's writes, in one place: a jump test, a single-leg pair, or a
 * readiness throw.
 *
 * Three streams, three destinations. A jump test and a single-leg pair are
 * both `jump_test_session` rows and differ only in the mode and the canonical
 * flag; a readiness throw goes to its own table, because channel B of the gate
 * is not a jump (`house.sc.readiness_gate`).
 *
 * On an edit the replacement is written first and the old row removed only
 * once it is on file. Twelve numbers over twelve weeks cannot be re-measured,
 * so a failed write must never be able to take the original with it.
 */

const FAILED = 'Could not save the test. Check your connection, then save again. Your numbers are still here.';
const EDIT_FAILED =
  'The edit did not save. Your original test is still on file. Check your connection, then save again.';
const ORPHANED =
  'The new test is saved, but the one it replaces is still in the ledger. Delete it there.';

export interface TestSaveInput {
  readonly localDate: string;
  readonly mode: string;
  readonly sessionId: string | null;
  readonly editingId: string | null;
  readonly config: ReadinessTestConfig;
  /** The jump best in inches, handed back to the caller after a save. */
  readonly bestIn: number | null;
  readonly onSaved?: (result: { readonly bestMm: number | null }) => void;
  readonly onDone: () => void;
}

export interface TestSave {
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
  readonly pending: boolean;
  readonly save: (draft: TestDraft) => Promise<void>;
}

export function useTestSave(input: TestSaveInput): TestSave {
  const recovery = useTodayRecovery();
  const logTest = useLogJumpTest();
  const deleteTest = useDeleteJumpTest();
  const logReadiness = useLogReadinessTest();
  const [error, setError] = useState<string | null>(null);

  const save = async (draft: TestDraft): Promise<void> => {
    setError(null);
    const kind = draftKind(draft);

    if (kind === 'readiness_throw') {
      try {
        await logReadiness.mutateAsync({
          localDate: input.localDate,
          kind: input.config.kind,
          metric: input.config.metric,
          attempts: throwAttempts(throwAttemptsOf(draft)),
          unit: storedUnit(input.config.metric),
          whoopRecoverySnapshot: snapshotOf(recovery.data),
        });
      } catch {
        setError(FAILED);
        return;
      }
      input.onSaved?.({ bestMm: null });
      input.onDone();
      return;
    }

    const isPair = kind === 'single_leg';
    try {
      await logTest.mutateAsync({
        localDate: input.localDate,
        instrument: draft.instrument,
        mode: isPair ? SINGLE_LEG_MODE : input.mode,
        sessionId: input.sessionId,
        // A single-leg pair is never canonical and never scheduled onto the
        // jump stream: it is its own mode, and nothing about it reaches the
        // trend, the pace, or a PR (`house.sc.asymmetry_tracking`).
        canonical: isPair ? false : draft.canonical,
        scheduled: isPair ? false : input.sessionId !== null,
        isBaseline: false,
        boxHeightMm: draft.boxHeightIn === null ? null : inToMm(draft.boxHeightIn),
        bodyweightKg: draft.bodyweightLb === null ? null : lbToKg(draft.bodyweightLb),
        whoopSnapshot: snapshotOf(recovery.data),
        notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
        attempts: isPair ? singleLegAttempts(draft) : draftAttempts(draft),
      });
    } catch {
      setError(input.editingId === null ? FAILED : EDIT_FAILED);
      return;
    }

    if (input.editingId !== null) {
      try {
        await deleteTest.mutateAsync(input.editingId);
      } catch {
        setError(ORPHANED);
        return;
      }
    }
    input.onSaved?.({ bestMm: input.bestIn === null ? null : inToMm(input.bestIn) });
    input.onDone();
  };

  return {
    error,
    setError,
    pending: logTest.isPending || deleteTest.isPending || logReadiness.isPending,
    save,
  };
}
