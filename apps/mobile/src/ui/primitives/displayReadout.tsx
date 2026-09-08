import { View, useWindowDimensions, type TextStyle } from 'react-native';
import { Text, displayVariantFor } from '../text';
import { displayOptical, space, type ColorToken } from '../theme';

export interface DisplayReadoutProps {
  /** The number alone, already formatted: "32.5". One per screen. */
  readonly value: string;
  /** "in". Sits beside the number on its baseline, never inside it. */
  readonly unit: string;
  readonly color?: ColorToken;
  /** The unit's tone. One step quieter than the number by default. */
  readonly unitColor?: ColorToken;
  /**
   * Hang the number's sidebearing out into the gutter so its first stem lands
   * on the text column. Off only where the readout is not the head of a
   * column and the optical hang would look like a misalignment instead.
   */
  readonly hang?: boolean;
  readonly testID?: string;
  readonly valueTestID?: string;
}

/**
 * The One Big Number: the current vertical on Progress, a test result, the
 * committed record. One per screen, by law.
 *
 * Three things are hand-set here that a plain `<Text variant="display">` gets
 * wrong. The number hangs left by the display instance's own digit sidebearing
 * (2 px at 64, 3 px at 96), so the stem and not the glyph box sits on the
 * column the eyebrow and the instrument label are already on. The unit rides
 * the number's own baseline rather than its box, so it cannot drift when the
 * viewport crosses into the wider instance. And the gap between them is the
 * one that survives the display tracking: at -0.024em the last digit's advance
 * is already 2.3 px short, so an 8 px flex gap lands as a 10 px optical gap,
 * which is the same optical gap the 64 px instance gets from the same 8.
 *
 * Nothing here animates. The number is a reading, and a reading that counts
 * itself up is theatre.
 */
export function DisplayReadout({
  value,
  unit,
  color = 'ink',
  unitColor = 'ink2',
  hang = true,
  testID,
  valueTestID,
}: DisplayReadoutProps) {
  const { width } = useWindowDimensions();
  const inset = hang ? displayOptical[displayVariantFor(width)] : 0;
  const valueStyle: TextStyle = { marginLeft: -inset };

  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}
    >
      <Text variant="display" color={color} style={valueStyle} testID={valueTestID}>
        {value}
      </Text>
      <Text variant="title" color={unitColor}>
        {unit}
      </Text>
    </View>
  );
}
