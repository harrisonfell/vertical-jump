import { View } from 'react-native';
import { useTheme } from '../theme';

/** How far the ring sits outside the control it belongs to. */
export const FOCUS_OFFSET = 2;
/** How thick the ring is. */
export const FOCUS_WIDTH = 2;

export interface FocusRingProps {
  readonly visible: boolean;
  /**
   * How far outside the control the ring is drawn, overriding the system's one
   * offset. There is exactly one focus treatment (2px ring, 2px offset), so a
   * control that passes this looks like a different system when tabbed
   * through, and `0` draws the ring on top of the control's own content.
   * Reserved for a control that genuinely clips.
   */
  readonly inset?: number;
}

/**
 * The keyboard focus ring: 2px of green, 2px outside the control, drawn as a
 * sibling rather than an outline so it looks identical on iOS and on the web.
 * Never shown for a pointer press: see useFocusVisible.
 */
export function FocusRing({ visible, inset }: FocusRingProps) {
  const { colors } = useTheme();
  if (!visible) return null;
  const edge = -(inset ?? FOCUS_OFFSET + FOCUS_WIDTH);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: edge,
        left: edge,
        right: edge,
        bottom: edge,
        borderWidth: FOCUS_WIDTH,
        borderColor: colors.green,
      }}
    />
  );
}
