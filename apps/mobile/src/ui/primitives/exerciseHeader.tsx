import { Pressable, View } from 'react-native';
import { ariaState, useFocusVisible } from '../a11y';
import { Glyph } from '../glyphs';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { FocusRing } from './focusRing';

export interface ExerciseHeaderProps {
  /** "Back squat". */
  readonly name: string;
  /** "Main lift · heavy strength · entered 275 lb · last 5 × 205 / 4 × 220". */
  readonly sub?: string;
  /** "New this week · replaces Nordic curl (3 weeks)" or "capped · knee". */
  readonly note?: string;
  /** "Both sides. One tap logs both." */
  readonly bothSides?: boolean;
  /** Opens the owner-supplied clip. Never autoplays. */
  readonly onVideo?: () => void;
  /** True once every set is logged: the block folds to one line. */
  readonly collapsed?: boolean;
  /** "done 5/5". */
  readonly doneLabel?: string;
  readonly onToggle?: () => void;
  readonly testID?: string;
}

/**
 * The head of one exercise. When every set under it is logged the whole block
 * folds to this line, which is why the collapsed state lives here and not in
 * the screen.
 */
export function ExerciseHeader({
  name,
  sub,
  note,
  bothSides = false,
  onVideo,
  collapsed = false,
  doneLabel,
  onToggle,
  testID,
}: ExerciseHeaderProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  const body = (
    <View style={{ flex: 1, gap: space.xxs }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <Text variant="title" color="ink">
          {name}
        </Text>
        {collapsed && doneLabel !== undefined ? (
          <Text variant="caption" color="ink2" numeric>
            {doneLabel}
          </Text>
        ) : null}
      </View>
      {collapsed || sub === undefined ? null : (
        <Text variant="caption" color="ink3">
          {sub}
        </Text>
      )}
      {collapsed || note === undefined ? null : (
        <Text variant="caption" color="ink2">
          {note}
        </Text>
      )}
      {collapsed || !bothSides ? null : (
        <Text variant="caption" color="ink2">
          Both sides. One tap logs both.
        </Text>
      )}
    </View>
  );

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingTop: space.md,
        paddingBottom: space.xs,
        minHeight: 44,
      }}
    >
      {onToggle === undefined ? (
        body
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}${doneLabel === undefined ? '' : `, ${doneLabel}`}`}
          accessibilityState={{ expanded: !collapsed }}
          {...ariaState({ expanded: !collapsed })}
          onPress={onToggle}
          onFocus={focusProps.onFocus}
          onBlur={focusProps.onBlur}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: 44,
            backgroundColor: pressed ? colors.paper3 : 'transparent',
          })}
        >
          <FocusRing visible={focusVisible} />
          {body}
        </Pressable>
      )}

      {onVideo === undefined ? null : <VideoControl onPress={onVideo} name={name} />}
    </View>
  );
}

interface VideoControlProps {
  readonly onPress: () => void;
  readonly name: string;
}

/** A 44px control with the play glyph and the word Video. Never an icon alone. */
function VideoControl({ onPress, name }: VideoControlProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Video: ${name}`}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        borderWidth: 1,
        borderColor: colors.rule,
        backgroundColor: pressed ? colors.paper3 : 'transparent',
      })}
    >
      <FocusRing visible={focusVisible} />
      <Glyph name="play" color={colors.ink2} size={16} />
      <Text variant="caption" color="ink2">
        Video
      </Text>
    </Pressable>
  );
}
