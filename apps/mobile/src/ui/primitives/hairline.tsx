import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export interface HairlineProps {
  /** Draw the heavier rule used for chart axes and the strongest divisions. */
  readonly strong?: boolean;
  /**
   * `danger` turns the rule under an invalid input the danger colour. It is
   * the full width of the field, never a stripe down its side, and the message
   * below it still names the cause: the rule points, the words explain.
   */
  readonly tone?: 'ink' | 'danger' | 'onGreen';
  /** Inset from the leading edge, so a rule can start past a row's gutter. */
  readonly inset?: number;
  readonly style?: ViewStyle;
}

/**
 * The only separator the system has: 1px of ink at low alpha. Never a border
 * on a card, never a coloured stripe.
 */
export function Hairline({ strong = false, tone = 'ink', inset = 0, style }: HairlineProps) {
  const { colors } = useTheme();
  // On a committed green surface the ink rule disappears, so the rule there is
  // the surface's own text colour held back to a hairline's weight of presence.
  const color =
    tone === 'danger'
      ? colors.danger
      : tone === 'onGreen'
        ? colors.onGreen
        : strong
          ? colors.ruleStrong
          : colors.rule;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height: 1,
          marginLeft: inset,
          backgroundColor: color,
          ...(tone === 'onGreen' ? { opacity: 0.3 } : null),
        },
        style,
      ]}
    />
  );
}
