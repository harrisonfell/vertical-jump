import { useCallback, useRef, useState } from 'react';
import type { SetPrescription } from '@vert/engine';
import { lbToKg } from '@vert/engine/units';
import type { Landing, SetLog } from '@/data';
import { useEditSet, useLogSet, useUndoSet } from '@/data';
import type { SetRowLogResult } from '@/ui';
import { editErrorLine } from './finish';
import { NO_SETS } from './exerciseSection';
import type { EditSetValue } from './editSetSheet';
import type { TodayExercise } from './model';
import { isMostRecentLog, nextUpLabel, restBarApplies, restSecondsFor } from './rest';
import { exerciseComplete } from './rows';
import type { RestControls } from './useRestTimer';
import type { TodayData } from './useTodayData';

/**
 * Every write the runner can make, in one hook.
 *
 * The screen file is a layout, so the rules about what a tap does live here:
 * what a failed write keeps, when the rest bar stops rather than renames
 * itself, and which row the next label is read from. Each callback is stable
 * across renders, which is what lets the exercise list sit still while the
 * rest bar ticks once a second underneath it.
 */

/** A set write that threw, kept whole so Retry sends exactly the same row. */
export interface FailedWrite {
  readonly exercise: TodayExercise;
  readonly set: SetPrescription;
  readonly extra: Partial<EditSetValue>;
}

export interface RunnerActionsInput {
  readonly data: TodayData;
  readonly exercises: readonly TodayExercise[];
  readonly rest: RestControls;
  /** Scrolls the runner to a measured offset. The hook owns the anchors. */
  readonly scrollTo: (y: number) => void;
}

export interface RunnerActions {
  /** Bumped per exercise by a bulk log so its rows re-seed from the store. */
  readonly generation: Readonly<Record<string, number>>;
  readonly landingFor: string | null;
  readonly failed: FailedWrite | null;
  readonly editing: { readonly exercise: TodayExercise; readonly set: SetPrescription } | null;
  readonly editError: string | null;
  readonly saving: boolean;
  retry(): void;
  logFor(exerciseRowId: string, setNumber: number): SetLog | null;
  onLogRow(exercise: TodayExercise, set: SetPrescription, result: SetRowLogResult): void;
  onUndo(exercise: TodayExercise, set: SetPrescription): void;
  fillRemaining(exercise: TodayExercise): void;
  logGroup(group: readonly TodayExercise[]): void;
  undoGroup(group: readonly TodayExercise[]): void;
  answerLanding(exercise: TodayExercise, landing: Landing): void;
  onAnchor(key: string, y: number): void;
  openEdit(exercise: TodayExercise, set: SetPrescription): void;
  closeEdit(): void;
  saveEdit(value: EditSetValue): void;
  deleteEdit(): void;
}

export function useRunnerActions({
  data,
  exercises,
  rest,
  scrollTo,
}: RunnerActionsInput): RunnerActions {
  const { session } = data;
  const logSet = useLogSet();
  const undoSet = useUndoSet();
  const editSet = useEditSet();

  const anchors = useRef(new Map<string, number>());
  const [generation, setGeneration] = useState<Record<string, number>>({});
  const [landingFor, setLandingFor] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedWrite | null>(null);
  const [editing, setEditing] = useState<{
    exercise: TodayExercise;
    set: SetPrescription;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const logged = data.loggedByExercise;
  const logByKey = data.logByKey;
  const logs = data.logs;

  const logFor = useCallback(
    (exerciseRowId: string, setNumber: number): SetLog | null =>
      logByKey.get(`${exerciseRowId}:${setNumber}`) ?? null,
    [logByKey],
  );

  const bump = useCallback((exerciseId: string) => {
    setGeneration((current) => ({ ...current, [exerciseId]: (current[exerciseId] ?? 0) + 1 }));
  }, []);

  const scrollToNextUndone = useCallback(
    (fromExercise: TodayExercise) => {
      const index = exercises.findIndex((entry) => entry.id === fromExercise.id);
      for (let i = index; i < exercises.length; i += 1) {
        const candidate = exercises[i];
        if (candidate === undefined) continue;
        if (exerciseComplete(candidate.sets, logged.get(candidate.id) ?? NO_SETS)) continue;
        const y = anchors.current.get(candidate.id);
        if (y !== undefined) scrollTo(Math.max(0, y - 24));
        return;
      }
    },
    [exercises, logged, scrollTo],
  );

  const writeSet = useCallback(
    (exercise: TodayExercise, set: SetPrescription, extra: Partial<EditSetValue> = {}) => {
      if (session === null) return;
      setFailed(null);
      logSet.mutate(
        {
          sessionId: session.id,
          sessionExerciseId: exercise.id,
          setNumber: set.setNumber,
          repsDone: extra.repsDone ?? set.reps ?? null,
          loadKg: extra.loadKg ?? set.loadKg ?? null,
          durationS: set.durationS ?? null,
          distanceM: set.distanceM ?? null,
          rpe: extra.rpe ?? set.targetRpe ?? null,
          ...(extra.side === undefined ? null : { side: extra.side }),
          loadSource: exercise.loadMode,
          plannedDate: session.scheduledDate,
        },
        // Nothing was written, so the copy never claims the phone kept it.
        { onError: () => setFailed({ exercise, set, extra }) },
      );
    },
    [logSet, session],
  );

  const onLog = useCallback(
    (
      exercise: TodayExercise,
      set: SetPrescription,
      result: Partial<EditSetValue>,
      /**
       * A second write for the same set: the other leg of a unilateral row.
       * The rest bar, the landing prompt and the scroll all belong to the set,
       * so they run once no matter how many legs it took.
       */
      alsoWrite?: Partial<EditSetValue>,
    ) => {
      writeSet(exercise, set, result);
      if (alsoWrite !== undefined) writeSet(exercise, set, alsoWrite);

      const last = exercise.sets[exercise.sets.length - 1];
      if (exercise.landingPromptOnLastSet && last?.setNumber === set.setNumber) {
        setLandingFor(exercise.id);
      }

      if (restBarApplies(exercise) && session !== null) {
        rest.start({
          seconds: restSecondsFor(exercise, set),
          label: nextUpLabel({
            exercises,
            // The store has not returned this row yet, so it is counted here.
            isLogged: (exerciseId, setNumber) =>
              (exerciseId === exercise.id && setNumber === set.setNumber) ||
              (logged.get(exerciseId)?.has(setNumber) ?? false),
            from: { exerciseId: exercise.id, set },
          }),
          sessionId: session.id,
        });
      } else {
        rest.stop();
      }

      scrollToNextUndone(exercise);
    },
    [exercises, logged, rest, scrollToNextUndone, session, writeSet],
  );

  const onLogRow = useCallback(
    (exercise: TodayExercise, set: SetPrescription, result: SetRowLogResult) => {
      const work = {
        repsDone: set.reps ?? null,
        loadKg: result.loadLb === null ? null : lbToKg(result.loadLb),
      };
      // A unilateral row answered per leg is two rows under one set number, so
      // the gap between the legs survives into the ledger. One answer, or none,
      // is the single row it has always been.
      if (result.rpeLeft !== null || result.rpeRight !== null) {
        onLog(
          exercise,
          set,
          { ...work, rpe: result.rpeLeft, side: 'left' },
          { ...work, rpe: result.rpeRight, side: 'right' },
        );
        return;
      }
      onLog(exercise, set, { ...work, rpe: result.rpe });
    },
    [onLog],
  );

  const onUndo = useCallback(
    (exercise: TodayExercise, set: SetPrescription) => {
      if (session === null) return;
      undoSet.mutate({
        sessionId: session.id,
        sessionExerciseId: exercise.id,
        setNumber: set.setNumber,
      });
      // Taking back the set the rest was started for ends the rest with it;
      // undoing an earlier row leaves the clock alone and only renames it.
      if (isMostRecentLog(logs, exercise.id, set.setNumber)) {
        rest.stop();
        return;
      }
      rest.relabel(
        nextUpLabel({
          exercises,
          isLogged: (exerciseId, setNumber) =>
            !(exerciseId === exercise.id && setNumber === set.setNumber) &&
            (logged.get(exerciseId)?.has(setNumber) ?? false),
          from: null,
        }),
      );
    },
    [exercises, logged, logs, rest, session, undoSet],
  );

  const fillRemaining = useCallback(
    (exercise: TodayExercise) => {
      const done = logged.get(exercise.id) ?? NO_SETS;
      for (const set of exercise.sets) {
        if (done.has(set.setNumber)) continue;
        writeSet(exercise, set);
      }
      bump(exercise.id);
      // The whole exercise is done, so the bar names what the athlete walks to.
      rest.relabel(
        nextUpLabel({
          exercises,
          isLogged: (exerciseId, setNumber) =>
            exerciseId === exercise.id || (logged.get(exerciseId)?.has(setNumber) ?? false),
          from: null,
        }),
      );
    },
    [bump, exercises, logged, rest, writeSet],
  );

  const logGroup = useCallback(
    (group: readonly TodayExercise[]) => {
      for (const exercise of group) fillRemaining(exercise);
    },
    [fillRemaining],
  );

  const undoGroup = useCallback(
    (group: readonly TodayExercise[]) => {
      if (session === null) return;
      for (const exercise of group) {
        for (const set of exercise.sets) {
          undoSet.mutate({
            sessionId: session.id,
            sessionExerciseId: exercise.id,
            setNumber: set.setNumber,
          });
        }
        bump(exercise.id);
      }
    },
    [bump, session, undoSet],
  );

  const answerLanding = useCallback(
    (exercise: TodayExercise, landing: Landing) => {
      setLandingFor(null);
      const last = exercise.sets[exercise.sets.length - 1];
      if (last === undefined) return;
      const log = logFor(exercise.id, last.setNumber);
      if (log === null) return;
      editSet.mutate({ setLogId: log.id, patch: { landing } });
    },
    [editSet, logFor],
  );

  const onAnchor = useCallback((key: string, y: number) => {
    anchors.current.set(key, y);
  }, []);

  const openEdit = useCallback((exercise: TodayExercise, set: SetPrescription) => {
    setEditError(null);
    setEditing({ exercise, set });
  }, []);

  const closeEdit = useCallback(() => {
    setEditError(null);
    setEditing(null);
  }, []);

  const saveEdit = useCallback(
    (value: EditSetValue) => {
      if (editing === null) return;
      const existing = logFor(editing.exercise.id, editing.set.setNumber);
      if (existing === null) {
        writeSet(editing.exercise, editing.set, value);
        setEditing(null);
        return;
      }
      // The sheet stays open until the write lands, so a failure never discards
      // the numbers the athlete just typed with chalk on their hands.
      setEditError(null);
      void editSet
        .mutateAsync({ setLogId: existing.id, patch: value })
        .then(() => setEditing(null))
        .catch((error: unknown) => setEditError(editErrorLine(error)));
    },
    [editSet, editing, logFor, writeSet],
  );

  const deleteEdit = useCallback(() => {
    if (editing === null) return;
    setEditError(null);
    onUndo(editing.exercise, editing.set);
    bump(editing.exercise.id);
    setEditing(null);
  }, [bump, editing, onUndo]);

  const retry = useCallback(() => {
    if (failed === null) return;
    writeSet(failed.exercise, failed.set, failed.extra);
  }, [failed, writeSet]);

  return {
    generation,
    landingFor,
    failed,
    editing,
    editError,
    saving: editSet.isPending || logSet.isPending,
    retry,
    logFor,
    onLogRow,
    onUndo,
    fillRemaining,
    logGroup,
    undoGroup,
    answerLanding,
    onAnchor,
    openEdit,
    closeEdit,
    saveEdit,
    deleteEdit,
  };
}
