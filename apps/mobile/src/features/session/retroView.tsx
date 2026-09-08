import { View } from 'react-native';
import { Button, ExerciseHeader, Hairline, Notice, SetRow, Text, space } from '@/ui';
import type { SessionExercise, SetLog } from '@/data/types';
import { readPrescriptions } from '@/features/plan';
import { groupExercises } from './blockNames';
import { compareSets } from './detail';

/**
 * Logging a missed session after the fact.
 *
 * The rows behave exactly as they do on Today: one tap logs the set as
 * written, a second undoes it. What differs is the date. The set keeps the day
 * it was prescribed for, and the store records how many days late it was
 * logged, so a retro-logged week counts in the ledger without pretending the
 * training happened today.
 */

export interface RetroViewProps {
  readonly exercises: readonly SessionExercise[];
  readonly logs: readonly SetLog[];
  readonly scheduledDateLabel: string;
  readonly onLogSet: (input: {
    readonly sessionExerciseId: string;
    readonly setNumber: number;
    readonly repsDone: number | null;
    readonly loadKg: number | null;
    readonly durationS: number | null;
  }) => void;
  readonly onUndoSet: (input: {
    readonly sessionExerciseId: string;
    readonly setNumber: number;
  }) => void;
  readonly onFinish: () => void;
  readonly onCancel: () => void;
  readonly finishing: boolean;
}

export function RetroView({
  exercises,
  logs,
  scheduledDateLabel,
  onLogSet,
  onUndoSet,
  onFinish,
  onCancel,
  finishing,
}: RetroViewProps) {
  const groups = groupExercises(exercises).filter((group) => !group.grouped);

  return (
    <View style={{ gap: space.lg }}>
      <Notice
        text={`Logging ${scheduledDateLabel} after the fact. Sets keep the day they were prescribed for.`}
        actionLabel="Stop logging"
        onAction={onCancel}
      />

      {groups.map((group) => (
        <View key={group.key} style={{ gap: space.xs }}>
          <Text variant="label" color="ink2">
            {group.name}
          </Text>
          <Hairline strong />
          {group.exercises.map((exercise) => {
            const rows = compareSets(
              readPrescriptions(exercise.perSet),
              logs.filter((log) => log.sessionExerciseId === exercise.id),
              { bothSides: exercise.bothSides },
            );
            return (
              <View key={exercise.id}>
                <ExerciseHeader
                  name={exercise.exerciseName}
                  {...(exercise.headerNote === null ? null : { sub: exercise.headerNote })}
                />
                {rows.map((row) => (
                  <SetRow
                    key={row.key}
                    index={row.index}
                    prescription={row.prescription}
                    {...(row.detail === null ? null : { detail: row.detail })}
                    kind={row.durationS === null ? 'loadable' : 'timed'}
                    {...(row.durationS === null ? null : { durationS: row.durationS })}
                    done={row.logged}
                    onLog={() =>
                      onLogSet({
                        sessionExerciseId: exercise.id,
                        setNumber: row.setNumber,
                        repsDone: row.reps,
                        loadKg: row.loadKg,
                        durationS: row.durationS,
                      })
                    }
                    onUndo={() =>
                      onUndoSet({ sessionExerciseId: exercise.id, setNumber: row.setNumber })
                    }
                  />
                ))}
              </View>
            );
          })}
        </View>
      ))}

      <Button label="Finish session" variant="primary" size={56} fullWidth onPress={onFinish} loading={finishing} />
    </View>
  );
}
