import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, View, type ViewStyle } from 'react-native';
import { ariaState, useFocusVisible, useReducedMotion } from '../a11y';
import { Glyph } from '../glyphs';
import { duration, easeOutQuart } from '../motion';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { chevronRotation, chevronTransition } from './disclosureMotion';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';

export interface DisclosureProps {
  /** "Rules summary", "Earlier weeks", "Top-set history". */
  readonly title: string;
  /** A muted count or line that stays visible while collapsed. */
  readonly summary?: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  /** Controlled mode: pass both to own the state from a screen. */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  readonly testID?: string;
}

/**
 * A headed section that collapses. The chevron turns 90 degrees over 200 ms,
 * or snaps under reduced motion. Nothing else moves: the content simply is or
 * is not there, because animating height is how lists get janky.
 *
 * The turn is driven two ways because the two platforms disagree about what
 * works: native animates an `Animated.Value`, the web sets the transform from
 * state and lets CSS carry it. See `disclosureMotion.ts` for why.
 */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  open,
  onToggle,
  testID,
}: DisclosureProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const reduced = useReducedMotion();

  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isOpen = open ?? uncontrolled;

  const web = Platform.OS === 'web';
  const spin = useRef(new Animated.Value(isOpen ? 1 : 0)).current;

  useEffect(() => {
    if (web) return;
    const target = isOpen ? 1 : 0;
    if (reduced) {
      spin.setValue(target);
      return;
    }
    const animation = Animated.timing(spin, {
      toValue: target,
      duration: duration.base,
      easing: easeOutQuart,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [isOpen, reduced, spin, web]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  const chevron = <Glyph name="chevron" color={colors.ink2} size={18} />;
  const webSpin: ViewStyle = { transform: [{ rotate: chevronRotation(isOpen) }] };
  const transition = chevronTransition(reduced);
  if (transition !== null) Object.assign(webSpin as Record<string, unknown>, transition);

  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: isOpen }}
        {...ariaState({ expanded: isOpen })}
        onPress={() => {
          const next = !isOpen;
          if (open === undefined) setUncontrolled(next);
          onToggle?.(next);
        }}
        onFocus={focusProps.onFocus}
        onBlur={focusProps.onBlur}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 44,
          paddingVertical: space.sm,
          backgroundColor: pressed ? colors.paper3 : 'transparent',
        })}
      >
        <FocusRing visible={focusVisible} />
        {web ? (
          <View style={webSpin}>{chevron}</View>
        ) : (
          <Animated.View style={{ transform: [{ rotate }] }}>{chevron}</Animated.View>
        )}
        <Text variant="title" color="ink" style={{ flex: 1 }}>
          {title}
        </Text>
        {summary === undefined ? null : (
          <Text variant="caption" color="ink3" numeric>
            {summary}
          </Text>
        )}
      </Pressable>
      <Hairline />
      {isOpen ? <View style={{ paddingTop: space.md, gap: space.md }}>{children}</View> : null}
    </View>
  );
}
