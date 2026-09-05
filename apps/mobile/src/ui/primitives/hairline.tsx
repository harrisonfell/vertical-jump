import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export interface HairlineProps {
  /** Draw the heavier rule used for chart axes and the strongest divisions. */
  readonly strong?: boolean;
  /** Inset from the leading edge, so a rule can start past a row's gutter. */
  readonly inset?: number;
  readonly style?: ViewStyle;
}

/**
 * The only separator the system has: 1px of ink at low alpha. Never a border
 * on a card, never a coloured stripe.
 */
export function Hairline({ strong = false, inset = 0, style }: HairlineProps) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height: 1,
          marginLeft: inset,
          backgroundColor: strong ? colors.ruleStrong : colors.rule,
        },
        style,
      ]}
    />
  );
}
