import { View } from 'react-native';
import { ExerciseHeader, Glyph, Hairline, Text, space, useTheme } from '@/ui';
import type { SessionExercise, SetLog } from '@/data/types';
// The store-to-engine seam lives with Plan; imported by module so the
// session bundle does not pull the Plan screen in with it.
import { readPrescriptions } from '@/features/plan';
import { groupExercises } from './blockNames';
import { compareSets, rowNoteLine, usesAddedLoadDisplay, type SetRowModel } from './detail';
import { rowNotesFor, type RowNotes } from './planNotes';

/**
 * A session's blocks and their sets, read-only.
 *
 * One rendering serves the two screens that report rather than run: a session
 * that has already happened, and one that has not happened yet. They differ in
 * a single fact - whether a set with no log is a set that was skipped or a set
 * still to come - and that fact is a boolean here rather than a second copy of
 * the layout. Nothing in this file is a control; logging lives in the runner.
 */

const EMPTY_NOTES: ReadonlyMap<string, RowNotes> = new Map();

function SetLine({ row, dim }: { readonly row: SetRowModel; readonly dim: boolean }) {
  const { colors } = useTheme();
  const suffix: string[] = [];
  if (row.rpe !== null) suffix.push(`RPE ${row.rpe}`);
  if (row.landing !== null) suffix.push(`landing ${row.landing}`);
  const detail = [row.detail, suffix.length === 0 ? null : suffix.join(' · ')]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 44,
          paddingVertical: space.sm,
          opacity: dim ? 0.7 : 1,
        }}
      >
        <Text variant="caption" color="ink3" numeric style={{ width: 24 }}>
          {row.index}
        </Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" color={dim ? 'ink2' : 'ink'} numeric>
            {row.prescription}
          </Text>
          {detail === '' ? null : (
            <Text variant="caption" color="ink3" numeric>
              {detail}
            </Text>
          )}
        </View>
        <View style={{ width: 20, alignItems: 'center' }}>
          {row.logged ? <Glyph name="check" size={16} color={colors.green} /> : null}
        </View>
      </View>
      <Hairline />
    </View>
  );
}

export interface ExerciseRowsProps {
  readonly exercise: SessionExercise;
  readonly logs: readonly SetLog[];
  readonly notes: RowNotes;
  /**
   * True on a day that has not arrived. Nothing is dimmed and nothing is
   * marked missing, because nothing has been missed.
   */
  readonly future?: boolean;
}

/** One exercise: its header, its prescribed sets, and what was done to them. */
export function ExerciseRows({ exercise, logs, notes, future = false }: ExerciseRowsProps) {
  const prescriptions = readPrescriptions(exercise.perSet);
  const rows = compareSets(
    prescriptions,
    logs.filter((log) => log.sessionExerciseId === exercise.id),
    {
      bothSides: exercise.bothSides,
      rpeMode: exercise.loadMode === 'rpe' || exercise.loadMode === 'week1',
      addedLoad: usesAddedLoadDisplay(prescriptions),
      future,
    },
  );

  const sub = [exercise.loadType.replace(/_/g, ' '), exercise.headerNote]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  // The weaker-side and grip lines were true of the day, not of the exercise,
  // so they sit with the rotation note rather than in the load line.
  const note = rowNoteLine(exercise.rotationNote, notes.sideNote, notes.fingerNote);

  return (
    <View>
      <ExerciseHeader
        name={exercise.exerciseName}
        sub={sub === '' ? undefined : sub}
        {...(note === null ? null : { note })}
        bothSides={exercise.bothSides}
      />
      {rows.map((row) => (
        <SetLine key={row.key} row={row} dim={!future && !row.logged} />
      ))}
      {exercise.lastTimeNote === null ? null : (
        <Text variant="caption" color="ink3" style={{ paddingTop: space.xs }} numeric>
          {exercise.lastTimeNote}
        </Text>
      )}
    </View>
  );
}

export interface SessionBlocksProps {
  readonly exercises: readonly SessionExercise[];
  readonly logs: readonly SetLog[];
  /** The per-row house notes from the session snapshot. */
  readonly rowNotes?: ReadonlyMap<string, RowNotes>;
  readonly future?: boolean;
}

/** Every block of one session, in rule-book order (R29 to R39). */
export function SessionBlocks({ exercises, logs, rowNotes, future = false }: SessionBlocksProps) {
  const notes: ReadonlyMap<string, RowNotes> = rowNotes ?? EMPTY_NOTES;

  return (
    <>
      {groupExercises(exercises).map((group) => (
        <View key={group.key} style={{ gap: space.xs }}>
          <Text variant="label" color="ink2">
            {group.name}
          </Text>
          <Hairline strong />
          {group.grouped ? (
            <Text variant="caption" color="ink2" style={{ paddingVertical: space.sm }}>
              {group.exercises.map((exercise) => exercise.exerciseName).join(' · ')}
            </Text>
          ) : (
            group.exercises.map((exercise) => (
              <ExerciseRows
                key={exercise.id}
                exercise={exercise}
                logs={logs}
                notes={rowNotesFor(notes, exercise.block, exercise.exerciseId)}
                future={future}
              />
            ))
          )}
        </View>
      ))}
    </>
  );
}
