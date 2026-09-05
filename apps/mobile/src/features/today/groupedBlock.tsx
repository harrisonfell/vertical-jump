import { View } from 'react-native';
import { formatInteger } from '@vert/engine/units';
import { Button, Disclosure, Text, space } from '@/ui';
import type { TodayExercise } from './model';

/**
 * The warm-up and the cool-down, as one collapsible group.
 *
 * Four rows of A-skips ahead of the main lift is four rows of scrolling
 * between the athlete and the thing they came to do, and none of it counts as
 * a contact. So the movements are a list, the group is one 44 px control, and
 * the set ledger still gets its rows when the control is tapped.
 */

export interface GroupedBlockProps {
  readonly label: string;
  readonly exercises: readonly TodayExercise[];
  /** Set numbers already written, keyed by exercise row id. */
  readonly loggedByExercise: ReadonlyMap<string, ReadonlySet<number>>;
  readonly onLogAll: () => void;
  readonly onUndoAll: () => void;
  readonly defaultOpen?: boolean;
  readonly testID?: string;
}

export function groupSummary(
  exercises: readonly TodayExercise[],
  loggedByExercise: ReadonlyMap<string, ReadonlySet<number>>,
): { readonly text: string; readonly done: boolean } {
  const sets = exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  const logged = exercises.reduce(
    (total, exercise) => total + (loggedByExercise.get(exercise.id)?.size ?? 0),
    0,
  );
  const done = sets > 0 && logged >= sets;
  return {
    done,
    text: done
      ? `done · ${formatInteger(exercises.length)} movements`
      : `${formatInteger(exercises.length)} movements · ${formatInteger(sets)} sets`,
  };
}

export function GroupedBlock({
  label,
  exercises,
  loggedByExercise,
  onLogAll,
  onUndoAll,
  defaultOpen = false,
  testID,
}: GroupedBlockProps) {
  const summary = groupSummary(exercises, loggedByExercise);

  return (
    <Disclosure title={label} summary={summary.text} defaultOpen={defaultOpen} testID={testID}>
      <View style={{ gap: space.sm }}>
        {exercises.map((exercise) => (
          <View
            key={exercise.id}
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}
          >
            <Text variant="body" color="ink" style={{ flex: 1 }}>
              {exercise.name}
            </Text>
            <Text variant="caption" color="ink3" numeric>
              {exercise.sets.map((set) => set.displayLoad).join(' · ')}
            </Text>
          </View>
        ))}

        <View style={{ paddingTop: space.sm, alignSelf: 'flex-start' }}>
          <Button
            label={summary.done ? `Undo ${label.toLowerCase()}` : `Log ${label.toLowerCase()}`}
            variant={summary.done ? 'quiet' : 'secondary'}
            onPress={summary.done ? onUndoAll : onLogAll}
          />
        </View>
      </View>
    </Disclosure>
  );
}
