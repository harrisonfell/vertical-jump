import { Pressable, View } from 'react-native';
import { formatInteger } from '@vert/engine/units';
import { joinParts } from '@vert/engine/analytics';
import { FocusRing, Hairline, Sheet, Text, space, useFocusVisible, useTheme } from '@/ui';
import type { WhoopConnection, WhoopWorkout } from '@/data/types';
import { REVOKED_MATCH_LINE } from '@/features/whoop/copy';
import { AWAITING_WORKOUT, sessionMinutes, workoutEvidenceLine } from './detail';

/**
 * The matched Whoop workout, and the sheet for changing it.
 *
 * Strain is heart-rate derived and under-reads plyometric and strength work,
 * so a matched workout is shown as evidence beside the session, never as its
 * load. Whoop's own words are kept unchanged, and the attribution sits with
 * the numbers (brief section 08, section 11).
 *
 * Nothing is claimed on Whoop's behalf that is not true right now: "awaiting
 * workout (checks for 24 h)" is a promise only a live connection can keep, so
 * an unmatched session says nothing at all until there is one.
 */

const WHOOP_ATTRIBUTION = 'Data by WHOOP';

function workoutMinutes(workout: WhoopWorkout): number | null {
  return sessionMinutes(workout.startAt, workout.endAt);
}

/** "6:41 PM", the local wall clock a workout started at. */
function clockOf(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(when);
  } catch {
    return '';
  }
}

export interface WhoopMatchProps {
  readonly workout: WhoopWorkout | null;
  readonly matchSource: 'auto' | 'manual' | null;
  /** Null before the connection row is read; drives what an empty match says. */
  readonly connectionStatus?: WhoopConnection['status'] | null;
  readonly candidates: readonly WhoopWorkout[];
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onPick: (workoutId: string) => void;
  readonly onClear: () => void;
}

function CandidateRow({
  workout,
  selected,
  onPick,
}: {
  readonly workout: WhoopWorkout;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const line = joinParts([
    clockOf(workout.startAt),
    workout.sportName,
    workoutMinutes(workout) === null ? null : `${formatInteger(workoutMinutes(workout) ?? 0)} min`,
    workout.strain === null ? null : `strain ${workout.strain.toFixed(1)}`,
  ]);

  return (
    <View>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        aria-checked={selected}
        accessibilityLabel={line}
        onPress={onPick}
        onFocus={focusProps.onFocus}
        onBlur={focusProps.onBlur}
        style={({ pressed }) => ({
          minHeight: 44,
          justifyContent: 'center',
          paddingVertical: space.sm,
          backgroundColor: pressed ? colors.paper3 : 'transparent',
        })}
      >
        <FocusRing visible={focusVisible} inset={2} />
        <Text variant="body" color={selected ? 'green' : 'ink'} numeric>
          {selected ? `${line} · matched` : line}
        </Text>
      </Pressable>
      <Hairline />
    </View>
  );
}

/**
 * What an unmatched session may say, given the connection.
 *
 * Null means the whole block stays off the screen: with no connection there is
 * no workout coming, and a line about one would be a claim about a service the
 * athlete has not linked.
 */
function unmatchedLine(status: WhoopConnection['status'] | null | undefined): string | null {
  if (status === undefined) return AWAITING_WORKOUT;
  if (status === 'connected' || status === 'connecting' || status === 'error') {
    return AWAITING_WORKOUT;
  }
  if (status === 'revoked') return REVOKED_MATCH_LINE;
  return null;
}

export function WhoopMatch({
  workout,
  matchSource,
  connectionStatus,
  candidates,
  open,
  onOpen,
  onClose,
  onPick,
  onClear,
}: WhoopMatchProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const clearFocus = useFocusVisible();

  const line =
    workout === null
      ? unmatchedLine(connectionStatus)
      : `Whoop: ${workoutEvidenceLine({
          sportName: workout.sportName,
          minutes: workoutMinutes(workout),
          strain: workout.strain,
          averageHeartRate: workout.averageHeartRate,
          matchSource,
        })}`;

  if (line === null) return null;

  return (
    <View style={{ gap: space.xs }}>
      <Text variant="body" color="ink" numeric style={{ maxWidth: 560 }}>
        {line}
      </Text>
      <Text variant="caption" color="ink3">
        {WHOOP_ATTRIBUTION}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change match"
        onPress={onOpen}
        onFocus={focusProps.onFocus}
        onBlur={focusProps.onBlur}
        style={({ pressed }) => ({
          minHeight: 44,
          justifyContent: 'center',
          alignSelf: 'flex-start',
          backgroundColor: pressed ? colors.paper3 : 'transparent',
        })}
      >
        <FocusRing visible={focusVisible} inset={2} />
        <Text variant="body" color="green">
          Change match
        </Text>
      </Pressable>

      <Sheet
        visible={open}
        onClose={onClose}
        title="Change match"
        subtitle="Workouts Whoop recorded around this session."
      >
        {candidates.length === 0 ? (
          <Text variant="body" color="ink2" style={{ maxWidth: 560 }}>
            No Whoop workouts in this window. A workout can arrive up to 24 hours late; the match
            is checked again on every sync.
          </Text>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel="Workouts around this session">
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                workout={candidate}
                selected={candidate.id === workout?.id}
                onPick={() => onPick(candidate.id)}
              />
            ))}
          </View>
        )}
        {workout === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove the match"
            onPress={onClear}
            onFocus={clearFocus.focusProps.onFocus}
            onBlur={clearFocus.focusProps.onBlur}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              alignSelf: 'flex-start',
              backgroundColor: pressed ? colors.paper3 : 'transparent',
            })}
          >
            <FocusRing visible={clearFocus.focusVisible} inset={2} />
            <Text variant="body" color="ink2">
              Remove the match
            </Text>
          </Pressable>
        )}
      </Sheet>
    </View>
  );
}
