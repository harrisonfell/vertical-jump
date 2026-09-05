import { View } from 'react-native';
import { Button, Hairline, Notice, Text, space } from '@/ui';
import { futureTargetsLine } from './detail';

/**
 * A session that has not happened yet: the week-level targets and nothing
 * else. Per-set loads are deliberately withheld, because soreness or a pain
 * change re-materializes the session on the morning and a number read three
 * days early is a number that moved.
 */

export interface FutureViewProps {
  readonly dayType: string;
  readonly mainLiftName: string | null;
  readonly workingSets: number | null;
  readonly weekNumber: number;
  readonly built: boolean;
  /**
   * True when this day carries hard finger work. Named three days out because
   * it is what the 48 h gap is measured from
   * (house rule `house.sc.hard_finger_spacing`).
   */
  readonly hardFinger?: boolean;
  /** The blocks the session will contain, as words. */
  readonly blocks: readonly string[];
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
  built,
  hardFinger = false,
  blocks,
  move,
}: FutureViewProps) {
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Text variant="body" color="ink" numeric style={{ maxWidth: 560 }}>
          {futureTargetsLine({ dayType, mainLiftName, workingSets, weekNumber, built, hardFinger })}
        </Text>
        {blocks.length === 0 ? null : (
          <Text variant="caption" color="ink3">
            {blocks.join(' · ')}
          </Text>
        )}
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
    </View>
  );
}
