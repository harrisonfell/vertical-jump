import { Pressable, View, useWindowDimensions } from 'react-native';
import { useFocusVisible } from '../a11y';
import { Glyph } from '../glyphs';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';

/** Whoop's own recovery vocabulary. Never used for series identity. */
export type RecoveryBand = 'low' | 'moderate' | 'high';

export type StripState = 'connected' | 'notConnected' | 'stale' | 'importing' | 'revoked';

/**
 * What one slot can honestly say.
 *
 * A missing number is never a zero and never a hidden row: Whoop has either
 * scored the day, not scored it yet, has no cycle for it, or is not linked at
 * all, and those are four different facts.
 */
export type StripSlotState = 'value' | 'pending' | 'noData' | 'notConnected';

/** The word a slot shows in place of a number. */
export const SLOT_STATE_WORD: Readonly<Record<Exclude<StripSlotState, 'value'>, string>> = {
  pending: 'pending',
  noData: 'no data',
  notConnected: 'not connected',
};

export interface StripSlot {
  /** "Recovery", "Sleep", "Strain". Whoop's words, unabbreviated. */
  readonly label: string;
  /** "67%", "84%", "13.4". Already formatted. Null in every other state. */
  readonly value: string | null;
  /** The second line: "7.2 h", "yday 13.2", or the band word beside its dot. */
  readonly detail?: string;
  /** Adds the band word and its dot, always beside the number, never instead. */
  readonly band?: RecoveryBand;
  readonly state: StripSlotState;
}

export interface StripProps {
  readonly state?: StripState;
  /** Recovery, Sleep, Strain. Three fixed slots, in that order. */
  readonly slots?: readonly StripSlot[];
  /** "6:40". Shown as "Data by WHOOP · synced 6:40". */
  readonly syncedAt?: string;
  /** "Whoop last synced 2 days ago" needs the days. */
  readonly staleDays?: number;
  readonly importedDays?: number;
  readonly importTotalDays?: number;
  /** Connect, Reconnect, or Retry, depending on the state. */
  readonly onAction?: () => void;
  readonly testID?: string;
}

const BAND_WORD: Readonly<Record<RecoveryBand, string>> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

/** Below this the three slots stop fitting side by side and fold to two rows. */
export const STRIP_WRAP_WIDTH = 420;

/**
 * The Whoop strip: three fixed slots with the attribution under them.
 *
 * Recovery, Sleep and Strain are always all three on screen, in that order,
 * because a slot that disappears on a bad night reads as a good night. It
 * never gives an instruction and never turns a number into a colour on its
 * own; the band word sits beside every dot.
 */
export function Strip({
  state = 'connected',
  slots = [],
  syncedAt,
  staleDays,
  importedDays,
  importTotalDays,
  onAction,
  testID,
}: StripProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  const caption =
    state === 'importing'
      ? `Importing Whoop history · ${importedDays ?? 0}/${importTotalDays ?? 90} days`
      : state === 'revoked'
        ? 'Whoop disconnected'
        : state === 'notConnected'
          ? 'Whoop not connected'
          : state === 'stale'
            ? `Data by WHOOP · last synced ${staleDays ?? 2} days ago`
            : `Data by WHOOP${syncedAt === undefined ? '' : ` · synced ${syncedAt}`}`;

  const actionLabel =
    state === 'revoked' ? 'Reconnect' : state === 'notConnected' ? 'Connect Whoop' : null;

  // Three repeats of "not connected" say one thing three times, so the row
  // says it once and the caption beside it offers the way back in.
  const unlinked = slots.length > 0 && slots.every((slot) => slot.state === 'notConnected');
  const narrow = width > 0 && width < STRIP_WRAP_WIDTH;

  return (
    <View testID={testID}>
      <View style={{ paddingVertical: space.md, gap: space.sm }}>
        {slots.length === 0 ? null : unlinked ? (
          <Text variant="body" color="ink3" testID="strip-unlinked">
            {`${slots.map((slot) => slot.label).join(', ')}: ${SLOT_STATE_WORD.notConnected}`}
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {slots.map((slot) => (
              <View
                key={slot.label}
                style={
                  narrow
                    ? { flexBasis: '45%', flexGrow: 1, gap: space.xxs }
                    : { flex: 1, gap: space.xxs }
                }
                testID={`strip-slot-${slot.label.toLowerCase()}`}
              >
                <Text variant="label" color="ink2" numberOfLines={1}>
                  {slot.label}
                </Text>
                {slot.state === 'value' && slot.value !== null ? (
                  <Text variant="rowNumber" color="ink" numeric>
                    {slot.value}
                  </Text>
                ) : (
                  <Text variant="body" color="ink3">
                    {SLOT_STATE_WORD[slot.state === 'value' ? 'noData' : slot.state]}
                  </Text>
                )}
                <SlotDetail
                  detail={slot.detail}
                  {...(slot.band === undefined ? null : { band: slot.band })}
                  dotColor={
                    slot.band === undefined ? null : colors.data[`recovery.${slot.band}`]
                  }
                />
              </View>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {state === 'importing' ? (
            <Glyph name="sync" color={colors.ink3} size={14} />
          ) : state === 'revoked' || state === 'notConnected' ? (
            <Glyph name="offline" color={colors.ink3} size={14} />
          ) : null}
          <Text variant="caption" color="ink3" accessibilityLiveRegion="polite">
            {caption}
          </Text>
          {actionLabel === null || onAction === undefined ? null : (
            <StripAction label={actionLabel} onPress={onAction} />
          )}
        </View>
      </View>
      <Hairline />
    </View>
  );
}

interface SlotDetailProps {
  readonly detail?: string;
  readonly band?: RecoveryBand;
  readonly dotColor: string | null;
}

/**
 * The slot's second line: the band word with its dot, or a plain fact like
 * "7.2 h". The dot is hidden from the screen reader because the word beside it
 * already carries everything the colour does.
 */
function SlotDetail({ detail, band, dotColor }: SlotDetailProps) {
  const text = band === undefined ? detail : BAND_WORD[band];
  if (text === undefined || text === '') return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      {dotColor === null ? null : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 8, height: 8, backgroundColor: dotColor }}
        />
      )}
      <Text variant="caption" color="ink2" numeric numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

interface StripActionProps {
  readonly label: string;
  readonly onPress: () => void;
}

function StripAction({ label, onPress }: StripActionProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: space.xs,
        backgroundColor: pressed ? colors.paper3 : 'transparent',
      })}
    >
      <FocusRing visible={focusVisible} />
      <Text variant="caption" color="green">
        {label}
      </Text>
    </Pressable>
  );
}
