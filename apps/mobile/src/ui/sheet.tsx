import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from './a11y';
import { BACKDROP_ALPHA, withAlpha } from './color';
import { duration, easeOutQuart } from './motion';
import { Button } from './primitives/button';
import { Hairline } from './primitives/hairline';
import { Text } from './text';
import { breakpoint, space, useTheme } from './theme';

export interface SheetState {
  readonly open: boolean;
  readonly show: () => void;
  readonly hide: () => void;
  readonly toggle: () => void;
}

/** The open and close pair every sheet needs, so screens do not hand-roll it. */
export function useSheet(initial = false): SheetState {
  const [open, setOpen] = useState(initial);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return { open, show, hide, toggle };
}

export interface SheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Names the sheet in headline type. */
  readonly title: string;
  /** One muted line under the title. */
  readonly subtitle?: string;
  readonly children: ReactNode;
  /** A sticky row of actions, pinned to the bottom above the safe area. */
  readonly actions?: ReactNode;
  /** The close control's word. "Close" by default; never an icon alone. */
  readonly closeLabel?: string;
  readonly testID?: string;
}

/**
 * The only lifted surface in the system. It arrives in 250 ms, carries one
 * soft ambient shadow so it reads as temporary, and is dismissed by Escape,
 * the backdrop, or the close control. Under reduced motion it fades in place.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  actions,
  closeLabel = 'Close',
  testID,
}: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const reduced = useReducedMotion();

  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? duration.fast : duration.sheet,
      easing: easeOutQuart,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced, visible]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.min(height * 0.25, 240), 0],
  });

  const wide = width >= breakpoint.tablet;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      testID={testID}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${title}`}
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: withAlpha(colors.ink, BACKDROP_ALPHA),
          }}
        />

        <Animated.View
          accessibilityViewIsModal
          style={{
            opacity: progress,
            transform: reduced ? [] : [{ translateY }],
            width: '100%',
            maxWidth: wide ? 560 : undefined,
            alignSelf: 'center',
            maxHeight: height * 0.9,
            backgroundColor: colors.paper,
            shadowColor: colors.ink,
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -8 },
            elevation: 12,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingTop: space.lg,
              paddingBottom: space.md,
            }}
          >
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="headline" accessibilityRole="header">
                {title}
              </Text>
              {subtitle === undefined ? null : (
                <Text variant="caption" color="ink2">
                  {subtitle}
                </Text>
              )}
            </View>
            <Button label={closeLabel} variant="quiet" onPress={onClose} />
          </View>
          <Hairline />

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              paddingHorizontal: space.lg,
              paddingVertical: space.lg,
              gap: space.lg,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {actions === undefined ? null : (
            <View>
              <Hairline />
              <View
                style={{
                  paddingHorizontal: space.lg,
                  paddingTop: space.md,
                  paddingBottom: Math.max(insets.bottom, space.md),
                  gap: space.sm,
                }}
              >
                {actions}
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
