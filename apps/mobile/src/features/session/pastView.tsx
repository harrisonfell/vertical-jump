import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { SessionContacts } from '@vert/engine';
import { Notice, Text, space } from '@/ui';
import type { SessionExercise, SessionWithStatus, SetLog } from '@/data/types';
import { SessionBlocks } from './exerciseRows';
import {
  doneSummaryLine,
  feelLine,
  fingerPainLine,
  sessionMinutes,
  tonnageLb,
} from './detail';
import type { RowNotes } from './planNotes';

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
  const finger = fingerPainLine(fingerPain);
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

      <SessionBlocks
        exercises={exercises}
        logs={logs}
        {...(rowNotes === undefined ? null : { rowNotes })}
      />
    </View>
  );
}
