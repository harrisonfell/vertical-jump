import { memo, useMemo } from 'react';
import { View } from 'react-native';
import type { SetPrescription } from '@vert/engine';
import { formatRest, kgToLb } from '@vert/engine/units';
import type { Landing, SetLog } from '@/data';
import {
  Button,
  Sheet,
  SetRow,
  Text,
  ExerciseHeader,
  space,
  useSheet,
  type SetRowLogResult,
} from '@/ui';
import { categoryOf } from '@/features/catalog';
import { blockLabel, loadTypeLabel } from './blocks';
import { climbPrescription } from './climbRows';
import { LandingPrompt } from './landingPrompt';
import type { TodayExercise } from './model';
import { doneLabel, exerciseComplete, rowDetail, rowIndex, rowKind, setsSummary } from './rows';

/**
 * One exercise: its header, its rows, and the two controls that belong to the
 * whole block rather than to a set.
 *
 * A finished exercise folds to its header line, because a screen of ticks is a
 * screen the athlete has to scroll past to find what is next.
 */

export interface ExerciseSectionProps {
  readonly exercise: TodayExercise;
  readonly logged: ReadonlySet<number>;
  readonly logFor: (setNumber: number) => SetLog | null;
  /** Bumped by "Done as written" so every row re-seeds from the store. */
  readonly generation: number;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onLog: (set: SetPrescription, result: SetRowLogResult) => void;
  readonly onUndo: (set: SetPrescription) => void;
  readonly onEdit: (set: SetPrescription) => void;
  readonly onFillRemaining: () => void;
  /** True right after the last set of a ladder was logged and before it answers. */
  readonly landingPending?: boolean;
  readonly onLanding?: (landing: Landing) => void;
  readonly onAnchor?: (key: string, y: number) => void;
  readonly disabled?: boolean;
}

/**
 * The one muted line under the name: "Main lift · 4 sets · 5 × 205 lb · est.
 * 270 lb".
 *
 * It opens with the block the exercise belongs to, which the spine no longer
 * repeats as a heading of its own, and then the prescription in the shape the
 * athlete reads it in. The load type ("heavy strength") comes off the line:
 * "4 sets · 5 × 205 lb" says the same thing in the system's own notation, and
 * the category glyph before the name already marks what kind of work it is.
 */
export function subLine(exercise: TodayExercise): string | undefined {
  const parts = [blockLabel(exercise.block)];
  const sets = setsSummary(exercise.sets);
  if (sets !== undefined) parts.push(sets);
  if (exercise.headerNote !== null && exercise.headerNote !== '') parts.push(exercise.headerNote);
  if (exercise.boxHeightIn !== null) parts.push(`box ${exercise.boxHeightIn} in`);
  // "last 5 × 205 / 4 × 220 / 3 × 235", already formatted by the engine.
  if (exercise.lastTimeNote !== null && exercise.lastTimeNote !== '') {
    parts.push(exercise.lastTimeNote);
  }
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/**
 * "New this week · replaces Nordic curl (3 weeks)", and the climbing captions
 * beside it: "Open hand only · Weaker side first: left · Alignment: stop the
 * set when the knee drifts".
 */
export function noteLine(exercise: TodayExercise): string | undefined {
  const parts: string[] = [];
  if (exercise.rotationNote !== null && exercise.rotationNote !== '') {
    parts.push(exercise.rotationNote);
  } else if (exercise.isNewThisWeek) {
    parts.push('New this week · first time');
  }
  parts.push(...exercise.captions);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

export function ExerciseSection({
  exercise,
  logged,
  logFor,
  generation,
  collapsed,
  onToggle,
  onLog,
  onUndo,
  onEdit,
  onFillRemaining,
  landingPending = false,
  onLanding,
  onAnchor,
  disabled = false,
}: ExerciseSectionProps) {
  const video = useSheet();
  const complete = exerciseComplete(exercise.sets, logged);
  const folded = complete && collapsed;

  const anyRpe = useMemo(
    () => exercise.sets.some((set) => rowKind(set, exercise.loadMode) === 'rpe'),
    [exercise.loadMode, exercise.sets],
  );

  // What kind of work this is, from the engine's own catalog. It rides the
  // header glyph so a wet thumb can tell a jump from a lift without reading.
  const category = categoryOf(exercise.exerciseId);

  return (
    <View
      onLayout={(event) => onAnchor?.(exercise.id, event.nativeEvent.layout.y)}
      testID={`exercise-${exercise.exerciseId}`}
    >
      <ExerciseHeader
        name={exercise.name}
        {...(category === undefined ? null : { category })}
        sub={subLine(exercise)}
        note={noteLine(exercise)}
        collapsed={folded}
        doneLabel={doneLabel(exercise.sets, logged)}
        onToggle={complete ? onToggle : undefined}
        onVideo={video.show}
      />

      {folded ? null : (
        <View>
          {exercise.sets.map((set, index) => {
            const log = logFor(set.setNumber);
            const loadLb =
              log?.loadKg != null ? Math.round(kgToLb(log.loadKg)) : prefillLoadLb(exercise, index);
            const detail = rowDetail({
              set,
              bothSides: exercise.bothSides,
              log: log === null ? null : toLoggedSet(log),
              note: exercise.rowNote,
            });

            return (
              <SetRow
                key={`${exercise.id}:${set.setNumber}:${generation}`}
                testID={`set-${exercise.exerciseId}-${set.setNumber}`}
                index={rowIndex(set)}
                prescription={climbPrescription(set, exercise.repCounted)}
                kind={rowKind(set, exercise.loadMode)}
                done={logged.has(set.setNumber)}
                disabled={disabled}
                loadLb={loadLb}
                {...(set.durationS === undefined ? null : { durationS: set.durationS })}
                {...(set.targetRpe === undefined ? null : { targetRpe: set.targetRpe })}
                perSide={exercise.bothSides}
                {...(detail === undefined ? null : { detail })}
                onLog={(result) => onLog(set, result)}
                onUndo={() => onUndo(set)}
                onEdit={() => onEdit(set)}
              />
            );
          })}

          {landingPending && onLanding !== undefined ? (
            <LandingPrompt onAnswer={onLanding} testID={`landing-${exercise.exerciseId}`} />
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.md,
              paddingTop: space.sm,
            }}
          >
            <Text variant="caption" color="ink3" numeric>
              {`Rest ${formatRest(exercise.restS)}`}
            </Text>
            {complete || anyRpe ? null : (
              <Button label="Done as written" variant="quiet" onPress={onFillRemaining} />
            )}
          </View>
        </View>
      )}

      <Sheet
        visible={video.open}
        onClose={video.hide}
        title={exercise.name}
        subtitle={loadTypeLabel(exercise.loadType)}
      >
        <View style={{ gap: space.md }}>
          <Text variant="body" color="ink2">
            No video yet. The cues are the fallback until a clip is added.
          </Text>
          {exercise.cues.length === 0 ? (
            <Text variant="body" color="ink3">
              No cues recorded for this exercise.
            </Text>
          ) : (
            exercise.cues.map((cue, index) => (
              <Text key={cue} variant="body" color="ink">
                {`${index + 1}. ${cue}`}
              </Text>
            ))
          )}
        </View>
      </Sheet>
    </View>
  );
}

function toLoggedSet(log: SetLog): {
  setNumber: number;
  repsDone: number | null;
  durationS: number | null;
  loadKg: number | null;
  rpe: number | null;
} {
  return {
    setNumber: log.setNumber,
    repsDone: log.repsDone,
    durationS: log.durationS,
    loadKg: log.loadKg,
    rpe: log.rpe,
  };
}

/**
 * An RPE row opens on the last load this lift saw: the set before it, then the
 * exercise's own prescription. A hint, never a commitment.
 */
function prefillLoadLb(exercise: TodayExercise, index: number): number | null {
  for (let i = index; i >= 0; i -= 1) {
    const set = exercise.sets[i];
    if (set?.loadKg !== undefined) return Math.round(kgToLb(set.loadKg));
  }
  return null;
}


/** No exercise is ever missing its logged set, so the empty case is shared. */
const NO_SETS: ReadonlySet<number> = new Set<number>();

export interface RunnerExerciseProps {
  readonly exercise: TodayExercise;
  readonly logged: ReadonlySet<number>;
  /** The whole session's logs, keyed `${sessionExerciseId}:${setNumber}`. */
  readonly logByKey: ReadonlyMap<string, SetLog>;
  readonly generation: number;
  readonly collapsed: boolean;
  readonly onToggle: (exercise: TodayExercise) => void;
  readonly onLog: (exercise: TodayExercise, set: SetPrescription, result: SetRowLogResult) => void;
  readonly onUndo: (exercise: TodayExercise, set: SetPrescription) => void;
  readonly onEdit: (exercise: TodayExercise, set: SetPrescription) => void;
  readonly onFillRemaining: (exercise: TodayExercise) => void;
  readonly landingPending: boolean;
  readonly onLanding: (exercise: TodayExercise, landing: Landing) => void;
  readonly onAnchor: (key: string, y: number) => void;
}

/**
 * One exercise, bound to handlers that do not change identity between renders.
 *
 * The rest bar ticks once a second for up to three minutes, and every tick
 * re-renders the runner. Nothing below this line has changed on those ticks,
 * so this is where the re-render stops: every prop is a value or a callback
 * the runner holds stable, and the exercise is bound here rather than in a
 * closure the parent rebuilds.
 */
export const RunnerExercise = memo(function RunnerExercise({
  exercise,
  logged,
  logByKey,
  generation,
  collapsed,
  onToggle,
  onLog,
  onUndo,
  onEdit,
  onFillRemaining,
  landingPending,
  onLanding,
  onAnchor,
}: RunnerExerciseProps) {
  return (
    <ExerciseSection
      exercise={exercise}
      logged={logged}
      logFor={(setNumber) => logByKey.get(`${exercise.id}:${setNumber}`) ?? null}
      generation={generation}
      collapsed={collapsed}
      onToggle={() => onToggle(exercise)}
      onLog={(set, result) => onLog(exercise, set, result)}
      onUndo={(set) => onUndo(exercise, set)}
      onEdit={(set) => onEdit(exercise, set)}
      onFillRemaining={() => onFillRemaining(exercise)}
      landingPending={landingPending}
      onLanding={(landing) => onLanding(exercise, landing)}
      onAnchor={onAnchor}
    />
  );
});

export { NO_SETS };
