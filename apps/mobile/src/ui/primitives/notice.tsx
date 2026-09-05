import { Pressable, View } from 'react-native';
import { useFocusVisible } from '../a11y';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';

export interface NoticeProps {
  /**
   * Computed from real numbers, never a slogan: "Deload week (5 of 12). Sets
   * and contacts cut by half. Loads held. Planned."
   */
  readonly text: string;
  /** A second line, muted: the reason or the rule in plain words. */
  readonly detail?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /** Announces itself when it appears after a change the athlete made. */
  readonly live?: boolean;
  readonly testID?: string;
}

/**
 * A rule-derived notice: body text on the second neutral, closed by hairlines
 * above and below. No stripe, no icon, no colour. It is a fact, so it looks
 * like the rest of the page and simply sits a tone apart.
 */
export function Notice({ text, detail, actionLabel, onAction, live = false, testID }: NoticeProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  return (
    <View testID={testID}>
      <Hairline />
      <View
        style={{
          backgroundColor: colors.paper2,
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          gap: space.xs,
        }}
      >
        <Text
          variant="body"
          color="ink"
          style={{ maxWidth: 560 }}
          {...(live ? { accessibilityLiveRegion: 'polite' as const } : null)}
        >
          {text}
        </Text>
        {detail === undefined ? null : (
          <Text variant="caption" color="ink2" style={{ maxWidth: 560 }}>
            {detail}
          </Text>
        )}
        {actionLabel === undefined || onAction === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={onAction}
            onFocus={focusProps.onFocus}
            onBlur={focusProps.onBlur}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              alignSelf: 'flex-start',
              backgroundColor: pressed ? colors.paper3 : 'transparent',
            })}
          >
            <FocusRing visible={focusVisible} />
            <Text variant="body" color="green">
              {actionLabel}
            </Text>
          </Pressable>
        )}
      </View>
      <Hairline />
    </View>
  );
}
