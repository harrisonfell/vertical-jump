import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { SessionContacts } from '@vert/engine';
import { ExerciseHeader, Glyph, Hairline, Notice, Text, space, useTheme } from '@/ui';
import type { SessionExercise, SessionWithStatus, SetLog } from '@/data/types';
// The store-to-engine seam lives with Plan; imported by module so the
// session bundle does not pull the Plan screen in with it.
import { readPrescriptions } from '@/features/plan';
import { groupExercises } from './blockNames';
import {
  compareSets,
  doneSummaryLine,
  feelLine,
  fingerPainLine,
  rowNoteLine,
  sessionMinutes,
  tonnageLb,
  usesAddedLoadDisplay,
  type SetRowModel,
} from './detail';
import { rowNotesFor, type RowNotes } from './planNotes';

/**
 * A session that has already happened: what was prescribed, what was done,
 * and the working max each lift was loaded from at the time.
 *
 * Nothing here is a control except the corrections the athlete is still
 * allowed to make. A finished session is a record, and a record that changes
 * shape when you look at it is not one. That is why the readiness line, the
 * finger answer and the per-row weaker-side and grip notes are read back off
 * the stored snapshot and the stored answers rather than recomputed.
 */

const EMPTY_NOTES: ReadonlyMap<string, RowNotes> = new Map();

export interface PastViewProps {
  readonly session: SessionWithStatus;
  readonly exercises: readonly SessionExercise[];
  readonly logs: readonly SetLog[];
  readonly contacts: SessionContacts | null;
  /** The line above the blocks: not-finished, or the after-build sentence. */
  readonly notice?: { readonly text: string; readonly actionLabel?: string; readonly onAction?: () => void };
  /**
   * What the readiness gate did to this session, in the words it said at the
   * time (house rule `house.sc.readiness_gate`). Absent when the gate did not
   * run that day.
   */
  readonly readinessLine?: string | null;
  /** The finger answer given before the session, 0 to 10, or null. */
  readonly fingerPain?: number | null;
  /** The per-row house notes from the session snapshot. */
  readonly rowNotes?: ReadonlyMap<string, RowNotes>;
  readonly children?: ReactNode;
}

function LoggedRow({ row }: { readonly row: SetRowModel }) {
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
          opacity: row.logged ? 1 : 0.7,
        }}
      >
        <Text variant="caption" color="ink3" numeric style={{ width: 24 }}>
          {row.index}
        </Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" color={row.logged ? 'ink' : 'ink2'} numeric>
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

function ExerciseRows({
  exercise,
  logs,
  notes,
}: {
  readonly exercise: SessionExercise;
  readonly logs: readonly SetLog[];
  readonly notes: RowNotes;
}) {
  const prescriptions = readPrescriptions(exercise.perSet);
  const rows = compareSets(
    prescriptions,
    logs.filter((log) => log.sessionExerciseId === exercise.id),
    {
      bothSides: exercise.bothSides,
      rpeMode: exercise.loadMode === 'rpe' || exercise.loadMode === 'week1',
      addedLoad: usesAddedLoadDisplay(prescriptions),
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
        <LoggedRow key={row.key} row={row} />
      ))}
      {exercise.lastTimeNote === null ? null : (
        <Text variant="caption" color="ink3" style={{ paddingTop: space.xs }} numeric>
          {exercise.lastTimeNote}
        </Text>
      )}
    </View>
  );
}

export function PastView({
  session,
  exercises,
  logs,
  contacts,
  notice,
  readinessLine = null,
  fingerPain = null,
  rowNotes,
  children,
}: PastViewProps) {
  const groups = groupExercises(exercises);
  const finger = fingerPainLine(fingerPain);
  const notes: ReadonlyMap<string, RowNotes> = rowNotes ?? EMPTY_NOTES;
  const prescribedSets = session.prescribedSetCount;
  const summary = doneSummaryLine({
    loggedSets: session.loggedSetCount,
    prescribedSets: prescribedSets === 0 ? session.loggedSetCount : prescribedSets,
    minutes: sessionMinutes(session.startedAt, session.markedCompleteAt),
    contacts,
    tonnageLb: tonnageLb(logs),
    rpe: session.rpe,
  });
  const feel = feelLine(session.sorenessPre, session.legsFeel);

  return (
    <View style={{ gap: space.lg }}>
      {notice === undefined ? null : (
        <Notice
          text={notice.text}
          {...(notice.actionLabel === undefined || notice.onAction === undefined
            ? null
            : { actionLabel: notice.actionLabel, onAction: notice.onAction })}
        />
      )}

      <View style={{ gap: space.xs }}>
        <Text variant="body" color="ink" numeric>
          {summary}
        </Text>
        {feel === null ? null : (
          <Text variant="caption" color="ink2" numeric>
            {feel}
          </Text>
        )}
        {finger === null ? null : (
          <Text variant="caption" color="ink2" numeric>
            {finger}
          </Text>
        )}
        {readinessLine === null || readinessLine === '' ? null : (
          <Text variant="caption" color="ink2" numeric style={{ maxWidth: 560 }}>
            {readinessLine}
          </Text>
        )}
        {session.notes === null || session.notes === '' ? null : (
          <Text variant="caption" color="ink2" style={{ maxWidth: 560 }}>
            {session.notes}
          </Text>
        )}
      </View>

      {children}

      {groups.map((group) => (
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
              />
            ))
          )}
        </View>
      ))}
    </View>
  );
}
