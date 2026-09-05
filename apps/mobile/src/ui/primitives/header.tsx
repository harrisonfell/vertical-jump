import { useContext, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { Hairline } from './hairline';
import { gutterFor, ScreenMeasureContext } from './screen';

export interface HeaderProps {
  /** "Week 7 of 12 · Power block · Full Body Strength" or "Progress". */
  readonly title: string;
  /** Right-aligned second string on the same line: "Mon 20 Oct". */
  readonly trailingText?: string;
  /** Label is the timing-board default; headline is for a titled screen. */
  readonly variant?: 'label' | 'headline';
  /** One muted line under the title. */
  readonly subtitle?: string;
  /** A 44px leading control: Back, on every route pushed off the tabs. */
  readonly back?: ReactNode;
  /** A 44px control, normally Settings. */
  readonly right?: ReactNode;
  readonly testID?: string;
}

/**
 * The slim screen header. It carries the sentence that tells the athlete where
 * they are, the way back out, and nothing else. A hairline closes it; there is
 * no bar, no tone change, and no shadow, so the header reads as the top of the
 * same sheet.
 */
export function Header({
  title,
  trailingText,
  variant = 'label',
  subtitle,
  back,
  right,
  testID,
}: HeaderProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const measure = useContext(ScreenMeasureContext);

  return (
    <View testID={testID} style={{ backgroundColor: colors.paper }}>
      <View style={measure === undefined ? undefined : { width: '100%', maxWidth: measure, alignSelf: 'center' }}>
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space.md,
            paddingBottom: variant === 'headline' ? space.sm : space.md,
            flexDirection: 'row',
            alignItems: variant === 'headline' ? 'flex-end' : 'center',
            gap: space.md,
            minHeight: 44,
          }}
        >
          {back}
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text
              variant={variant}
              color={variant === 'label' ? 'ink2' : 'ink'}
              accessibilityRole="header"
              numberOfLines={2}
            >
              {title}
            </Text>
            {subtitle === undefined ? null : (
              <Text variant="caption" color="ink3">
                {subtitle}
              </Text>
            )}
          </View>
          {trailingText === undefined ? null : (
            <Text variant="label" color="ink2">
              {trailingText}
            </Text>
          )}
          {right}
        </View>
      </View>
      <Hairline />
    </View>
  );
}
