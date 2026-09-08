import { Pressable, View } from 'react-native';
import { ariaState, useFocusVisible } from '../a11y';
import { CATEGORY_LABEL, CategoryMark, type CategoryName } from '../dataMarks';
import { Glyph } from '../glyphs';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { FocusRing } from './focusRing';

export interface ExerciseHeaderProps {
  /** "Back squat". */
  readonly name: string;
  /**
   * The engine's chart category for this exercise, drawn as a tinted glyph
   * before the name. It is what tells the athlete at arm's length whether the
   * next block is a jump, a lift, or a mobility drill, without reading it.
   * The word itself goes into the accessible label rather than onto the line,
   * because the sub line already says the specific thing ("heavy strength")
   * and the category would only repeat it in coarser words.
   */
  readonly category?: CategoryName;
  /** "Main lift · heavy strength · entered 275 lb · last 5 × 205 / 4 × 220". */
  readonly sub?: string;
  /** "New this week · replaces Nordic curl (3 weeks)" or "capped · knee". */
  readonly note?: string;
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
 *
 * A unilateral exercise says nothing here: every set row under it already
 * carries "each side", on the row the thumb lands on.
 */
export function ExerciseHeader({
  name,
  category,
  sub,
  note,
  onVideo,
  collapsed = false,
  doneLabel,
  onToggle,
  testID,
}: ExerciseHeaderProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  // The mark is hidden from the screen reader, so the category has to be
  // spoken by the line that owns it or it is lost along with the colour.
  const spokenName =
    category === undefined ? name : `${CATEGORY_LABEL[category]}, ${name}`;

  const body = (
    <View style={{ flex: 1, gap: space.xxs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {category === undefined ? null : <CategoryMark category={category} />}
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
        category === undefined ? (
          body
        ) : (
          <View accessible accessibilityLabel={spokenName} style={{ flex: 1 }}>
            {body}
          </View>
        )
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            doneLabel === undefined ? spokenName : `${spokenName}, ${doneLabel}`
          }
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
