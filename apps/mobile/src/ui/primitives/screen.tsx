import type { ReactNode } from 'react';
import { Platform, ScrollView, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { breakpoint, space, useTheme } from '../theme';

/** Content measures for the two layouts the system has. */
export const CONTENT_WIDTH = { narrow: 640, wide: 1024 } as const;

/** The gutter for a viewport width. 16 on a phone, 24 from the tablet up. */
export function gutterFor(width: number): number {
  return width >= breakpoint.tablet ? space.xl : space.lg;
}

export interface ScreenProps {
  readonly children: ReactNode;
  /** Scrolls by default. Pass false for a screen that owns its own list. */
  readonly scroll?: boolean;
  /** Two-column measure (1024) instead of the reading measure (640). */
  readonly wide?: boolean;
  /** Override the content measure entirely. */
  readonly maxWidth?: number;
  /** A slim header pinned above the scroll area. */
  readonly header?: ReactNode;
  /** A sticky strip above the tab bar: the rest bar, a finish action. */
  readonly footer?: ReactNode;
  /** Drop the horizontal gutter so a child can bleed to the edges. */
  readonly bleed?: boolean;
  /** Vertical gap between direct children. */
  readonly gap?: number;
  readonly contentStyle?: ViewStyle;
  readonly testID?: string;
}

/**
 * Every screen's frame: safe areas, gutters, and one content measure. It never
 * draws a card, a border, or a shadow; the ground is paper and stays paper.
 */
export function Screen({
  children,
  scroll = true,
  wide = false,
  maxWidth,
  header,
  footer,
  bleed = false,
  gap = space.lg,
  contentStyle,
  testID,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const gutter = bleed ? 0 : gutterFor(width);
  const measure = maxWidth ?? (wide ? CONTENT_WIDTH.wide : CONTENT_WIDTH.narrow);

  const inner: ViewStyle = {
    width: '100%',
    maxWidth: measure,
    alignSelf: 'center',
    paddingHorizontal: gutter,
    gap,
  };

  const body = <View style={[inner, contentStyle]}>{children}</View>;

  // The desktop scrollbar is drawn over the content on the web, and the thing
  // it lands on is the set row's 44px check target. Reserving the gutter keeps
  // the column inside the track whether or not the page happens to scroll.
  const scrollStyle: ViewStyle = { flex: 1 };
  if (Platform.OS === 'web') {
    (scrollStyle as Record<string, unknown>)['scrollbarGutter'] = 'stable';
  }

  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: colors.paper }}>
      {header === undefined ? null : (
        <View style={{ paddingTop: insets.top }}>{header}</View>
      )}
      {scroll ? (
        <ScrollView
          style={scrollStyle}
          contentContainerStyle={{
            paddingTop: header === undefined ? insets.top + space.lg : space.lg,
            paddingBottom: space.xxxl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: header === undefined ? insets.top : 0 }}>{body}</View>
      )}
      {footer === undefined ? null : <View>{footer}</View>}
    </View>
  );
}

export interface TwoColumnProps {
  readonly left: ReactNode;
  readonly right: ReactNode;
  /** Fraction of the width the left column takes at 1024 and up. */
  readonly leftFlex?: number;
  readonly rightFlex?: number;
  readonly gap?: number;
}

/**
 * Progress at 1024 and up: number, pace, and charts on the left, the headed
 * sections on the right. Under 1024 it is one column in reading order.
 */
export function TwoColumn({
  left,
  right,
  leftFlex = 3,
  rightFlex = 2,
  gap = space.xl,
}: TwoColumnProps) {
  const { width } = useWindowDimensions();
  const side = width >= breakpoint.desktop;

  if (!side) {
    return (
      <View style={{ gap }}>
        <View style={{ gap }}>{left}</View>
        <View style={{ gap }}>{right}</View>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap, alignItems: 'flex-start' }}>
      <View style={{ flex: leftFlex, gap }}>{left}</View>
      <View style={{ flex: rightFlex, gap }}>{right}</View>
    </View>
  );
}
