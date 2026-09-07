import { View } from 'react-native';
import { Button, Hairline, Notice, Text, space } from '@/ui';
import type { SessionExercise } from '@/data/types';
import { PROJECTED_CAPTION, futureTargetsLine, notBuiltLine } from './detail';
import { SessionBlocks } from './exerciseRows';
import type { RowNotes } from './planNotes';

/**
 * A session that has not happened yet: the whole workout, read-only.
 *
 * Every week of the program is written at build, so a day three weeks out has
 * real blocks, real exercises and real sets. It shows them. The loads it shows
 * are the plan's best guess and the caption says so, which is a better deal
 * than the outline this screen used to offer: an athlete who cannot see
 * Thursday cannot plan Thursday.
 *
 * Nothing here logs anything. The runner is Today's job, and it stays there.
 */

export interface FutureViewProps {
  readonly dayType: string;
  readonly mainLiftName: string | null;
  readonly workingSets: number | null;
  /** The week this session sits in, for the not-built-yet fallback. */
  readonly weekNumber: number;
  /**
   * True when this day carries hard finger work. Named three days out because
   * it is what the 48 h gap is measured from
   * (house rule `house.sc.hard_finger_spacing`).
   */
  readonly hardFinger?: boolean;
  /** Every exercise this session prescribes, in store order. */
  readonly exercises: readonly SessionExercise[];
  /** The per-row house notes from the session snapshot. */
  readonly rowNotes?: ReadonlyMap<string, RowNotes>;
  /**
   * True when the week was written ahead of the athlete reaching it
   * (`generatedBy` 'projection' or 'revision'). It earns the one caption.
   */
  readonly projected: boolean;
  /** Present only when today is a rest day in the same week. */
  readonly move:
    | { readonly ok: true; readonly onMove: () => void; readonly pending: boolean }
    | { readonly ok: false; readonly reason: string }
    | null;
}

export function FutureView({
  dayType,
  mainLiftName,
  workingSets,
  weekNumber,
  hardFinger = false,
  exercises,
  rowNotes,
  projected,
  move,
}: FutureViewProps) {
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Text variant="body" color="ink" numeric style={{ maxWidth: 560 }}>
          {futureTargetsLine({ dayType, mainLiftName, workingSets, hardFinger })}
        </Text>
        {projected ? (
          <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
            {PROJECTED_CAPTION}
          </Text>
        ) : null}
      </View>

      <Hairline />

      {move === null ? null : move.ok ? (
        <View style={{ gap: space.sm }}>
          <Text variant="caption" color="ink2" style={{ maxWidth: 560 }}>
            Today is a rest day. This session can move here.
          </Text>
          <Button
            label="Do this today"
            variant="primary"
            onPress={move.onMove}
            loading={move.pending}
          />
        </View>
      ) : (
        <Notice text={move.reason} />
      )}

      {exercises.length === 0 ? (
        <Text variant="body" color="ink2" style={{ maxWidth: 560 }}>
          {notBuiltLine(weekNumber)}
        </Text>
      ) : (
        <SessionBlocks
          exercises={exercises}
          logs={[]}
          future
          {...(rowNotes === undefined ? null : { rowNotes })}
        />
      )}
    </View>
  );
}
