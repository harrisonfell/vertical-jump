import { View } from 'react-native';
import { Glyph, type GlyphName } from './glyphs';
import { Text } from './text';
import { space, useTheme } from './theme';
import type { DataTokenName } from './tokens.generated';

/**
 * The two data vocabularies the app colours, and the marks that draw them.
 *
 * Everything here obeys one rule: a data colour never works alone. Each mark
 * ships a glyph whose shape already separates it from its siblings, and a word
 * that says what it is, so the colour is the third channel rather than the
 * only one. Strip the colour and the mark still reads; that is the test.
 *
 * These colours also never touch chrome. A category tints a glyph in a header
 * and a series in a chart. It never tints a button, a background, a rule, or a
 * row, because those belong to the accent and the accent means something else.
 */

/** The engine's `ChartCategory`, in its fixed order. Never cycled. */
export type CategoryName = 'strength' | 'plyometrics' | 'technique' | 'mobility';

export const CATEGORY_NAMES: readonly CategoryName[] = [
  'strength',
  'plyometrics',
  'technique',
  'mobility',
];

/** The word beside the mark, and the word a screen reader hears. */
export const CATEGORY_LABEL: Readonly<Record<CategoryName, string>> = {
  strength: 'Strength',
  plyometrics: 'Plyometrics',
  technique: 'Technique',
  mobility: 'Mobility',
};

/** The shape that carries the category when the colour cannot. */
export const CATEGORY_GLYPH: Readonly<Record<CategoryName, GlyphName>> = {
  strength: 'category-strength',
  plyometrics: 'category-plyometrics',
  technique: 'category-technique',
  mobility: 'category-mobility',
};

export function categoryToken(name: CategoryName): DataTokenName {
  return `category.${name}` as DataTokenName;
}

/** True for a string the engine could have emitted as a chart category. */
export function isCategoryName(value: string): value is CategoryName {
  return (CATEGORY_NAMES as readonly string[]).includes(value);
}

export interface CategoryMarkProps {
  readonly category: CategoryName;
  readonly size?: number;
  /**
   * Draws the category word after the glyph. Off inside a row whose own
   * accessible label already names the category, on wherever the mark stands
   * by itself.
   */
  readonly showLabel?: boolean;
}

/**
 * One training category, as a tinted glyph and optionally its word.
 *
 * The glyph is hidden from the screen reader when the word is hidden too: in
 * that case the row around it names the category in its own label, and a
 * second announcement would make every exercise read twice.
 */
export function CategoryMark({ category, size = 16, showLabel = false }: CategoryMarkProps) {
  const { colors } = useTheme();
  const tint = colors.data[categoryToken(category)];

  if (!showLabel) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, alignItems: 'center', justifyContent: 'center' }}
      >
        <Glyph name={CATEGORY_GLYPH[category]} color={tint} size={size} />
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Glyph name={CATEGORY_GLYPH[category]} color={tint} size={size} />
      <Text variant="caption" color="ink2">
        {CATEGORY_LABEL[category]}
      </Text>
    </View>
  );
}

/** Whoop's own three bands, in Whoop's own words. */
export type RecoveryBandName = 'low' | 'moderate' | 'high';

/** Low to high, the order every key and legend lists them in. Never cycled. */
export const RECOVERY_BANDS: readonly RecoveryBandName[] = ['low', 'moderate', 'high'];

export const RECOVERY_LABEL: Readonly<Record<RecoveryBandName, string>> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

export function recoveryToken(band: RecoveryBandName): DataTokenName {
  return `recovery.${band}` as DataTokenName;
}
