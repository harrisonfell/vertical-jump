import { View } from 'react-native';
import { space, useTheme } from '../theme';
import { Button } from './button';
import type { GlyphName } from '../glyphs';

/**
 * The session's one action, held in the bottom right corner where the thumb
 * already is.
 *
 * It floats over the scroll rather than sitting at the end of it, because the
 * end of a session list is a long way from the set the athlete just logged. It
 * is the primary button at its full 56px height and nothing else: no shadow
 * (the system is flat), no radius, no icon standing alone. What separates it
 * from the rows sliding under it is a 1px cut of the paper ground, which is a
 * gap rather than a lift.
 *
 * One per screen. If a screen needs two actions here, one of them is not an
 * action for this screen.
 */

export interface FloatingActionProps {
  /** Verb plus object: "Finish session", "Continue session". */
  readonly label: string;
  readonly onPress: () => void;
  readonly glyph?: GlyphName;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function FloatingAction({
  label,
  onPress,
  glyph,
  accessibilityHint,
  testID,
}: FloatingActionProps) {
  const { colors } = useTheme();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', right: 0, bottom: space.lg, alignItems: 'flex-end' }}
    >
      <View style={{ borderWidth: 1, borderColor: colors.paper }}>
        <Button
          label={label}
          variant="primary"
          size={56}
          onPress={onPress}
          {...(glyph === undefined ? null : { glyph })}
          {...(accessibilityHint === undefined ? null : { accessibilityHint })}
          {...(testID === undefined ? null : { testID })}
        />
      </View>
    </View>
  );
}
