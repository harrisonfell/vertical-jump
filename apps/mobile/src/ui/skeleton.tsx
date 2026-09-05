import { useEffect, useRef } from 'react';
import { Animated, Platform, View } from 'react-native';
import { ariaState, useReducedMotion } from './a11y';
import { SKELETON_CYCLE_MS, SKELETON_OPACITY, easeOutQuart } from './motion';
import { Hairline } from './primitives/hairline';
import { SET_ROW_GRID } from './primitives/setRow';
import { space, useTheme } from './theme';

/** The layouts a skeleton can mirror. Each matches its real component's box. */
export type SkeletonKind = 'setRow' | 'header' | 'strip' | 'chartPanel' | 'line';

export interface SkeletonProps {
  readonly skeletonFor: SkeletonKind;
  /** How many of this shape to draw. */
  readonly count?: number;
  readonly testID?: string;
}

interface BlockProps {
  readonly width: number | `${number}%`;
  readonly height: number;
  readonly opacity: Animated.Value | number;
}

function Block({ width, height, opacity }: BlockProps) {
  const { colors } = useTheme();
  return (
    <Animated.View
      style={{ width, height, opacity, backgroundColor: colors.paper3 }}
    />
  );
}

/**
 * Loading blocks sized to the real layout, so nothing moves when the data
 * lands. The breath is a slow opacity cycle and never a sweeping gradient;
 * under reduced motion it holds still at its brighter end.
 */
export function Skeleton({ skeletonFor, count = 1, testID }: SkeletonProps) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(SKELETON_OPACITY.to)).current;

  useEffect(() => {
    if (reduced) {
      pulse.setValue(SKELETON_OPACITY.to);
      return;
    }
    const half = SKELETON_CYCLE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: SKELETON_OPACITY.from,
          duration: half,
          easing: easeOutQuart,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: SKELETON_OPACITY.to,
          duration: half,
          easing: easeOutQuart,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  const opacity: Animated.Value | number = reduced ? SKELETON_OPACITY.to : pulse;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessibilityState={{ busy: true }}
      {...ariaState({ busy: true })}
      style={{ gap: space.sm }}
    >
      {Array.from({ length: count }, (_, index) => (
        <Shape key={index} kind={skeletonFor} opacity={opacity} />
      ))}
    </View>
  );
}

interface ShapeProps {
  readonly kind: SkeletonKind;
  readonly opacity: Animated.Value | number;
}

function Shape({ kind, opacity }: ShapeProps) {
  switch (kind) {
    case 'setRow':
      return (
        <View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SET_ROW_GRID.gap,
              minHeight: SET_ROW_GRID.minHeight,
            }}
          >
            <Block width={SET_ROW_GRID.index} height={12} opacity={opacity} />
            {/* Exactly the set row's own label-over-value gap: a skeleton
                whose whole job is not to move when the data lands cannot be
                4px out from the shape it stands in for. */}
            <View style={{ flex: 1, gap: space.xxs }}>
              <Block width="60%" height={20} opacity={opacity} />
              <Block width="32%" height={12} opacity={opacity} />
            </View>
            <Block width={SET_ROW_GRID.control} height={SET_ROW_GRID.control} opacity={opacity} />
            <Block width={SET_ROW_GRID.control} height={SET_ROW_GRID.control} opacity={opacity} />
          </View>
          <Hairline />
        </View>
      );

    case 'header':
      return (
        <View style={{ gap: 8, paddingVertical: space.md, minHeight: 44 }}>
          <Block width="70%" height={16} opacity={opacity} />
          <Block width="40%" height={12} opacity={opacity} />
        </View>
      );

    case 'strip':
      return (
        <View>
          <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md }}>
            <Block width={96} height={16} opacity={opacity} />
            <Block width={72} height={16} opacity={opacity} />
            <Block width={88} height={16} opacity={opacity} />
          </View>
          <Hairline />
        </View>
      );

    case 'chartPanel':
      return (
        <View style={{ gap: space.sm }}>
          <Block width="35%" height={12} opacity={opacity} />
          <Block width="100%" height={180} opacity={opacity} />
          <Block width="55%" height={12} opacity={opacity} />
        </View>
      );

    case 'line':
      return <Block width="100%" height={16} opacity={opacity} />;
  }
}
