import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { kvStore, useDbOrNull } from '@/data';
import { useSessionStore } from '@/state/session';

/**
 * The two pieces of screen state Today owns: which finished exercises are open
 * again, and whether the one coach mark has been dismissed.
 *
 * The expanded set is ephemeral and lives in the zustand store; losing it costs
 * a tap. The dismissal is durable and lives in kv, because being told how to
 * tap a row twice is worse than not being told at all.
 */

export interface TodayUi {
  readonly expandedExerciseIds: readonly string[];
  readonly coachMarkVisible: boolean;
  toggleExercise(exerciseId: string): void;
  dismissCoachMark(mark: string): void;
}

export function useTodayUi(mark: string, eligible: boolean): TodayUi {
  const db = useDbOrNull();
  const client = useQueryClient();
  const expandedExerciseIds = useSessionStore((state) => state.expandedExerciseIds);
  const toggleExercise = useSessionStore((state) => state.toggleExercise);
  const setDismissed = useSessionStore((state) => state.setDismissedCoachMarks);

  const dismissed = useQuery({
    queryKey: ['kv', 'coachMarks'],
    enabled: db !== null,
    queryFn: async (): Promise<string[]> => (db === null ? [] : kvStore.listDismissedCoachMarks(db)),
  });

  const dismissCoachMark = useCallback(
    (name: string) => {
      if (db === null) return;
      void kvStore.dismissCoachMark(db, name).then((marks) => {
        setDismissed(marks);
        void client.invalidateQueries({ queryKey: ['kv', 'coachMarks'] });
      });
    },
    [client, db, setDismissed],
  );

  return {
    expandedExerciseIds,
    coachMarkVisible: eligible && dismissed.isSuccess && !dismissed.data.includes(mark),
    toggleExercise,
    dismissCoachMark,
  };
}
