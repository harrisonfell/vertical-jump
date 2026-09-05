import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { ariaState, useFocusVisible } from '../a11y';
import { Glyph } from '../glyphs';
import { FocusRing } from '../primitives/focusRing';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import type { NavItem } from './items';

/** The bar and the rail give an item the same height: a comfortable target. */
export const NAV_ITEM_HEIGHT = 56;

export interface NavItemButtonProps {
  readonly item: NavItem;
  readonly active: boolean;
  /** The bar stretches its items; the rail stacks them at a fixed height. */
  readonly layout: 'bar' | 'rail';
}

/**
 * One destination, glyph over word. Never a glyph alone: three destinations do
 * not justify making the athlete learn three pictures.
 *
 * It navigates through the router rather than through `<Link asChild>`. The
 * `asChild` form clones its child with the link's own props, and on the web
 * that meant the child's `style` and `accessibilityRole` were both replaced:
 * every item rendered as an unstyled `role="link"` anchor sized to its own
 * text, so the three of them packed against the left edge of the bar reading
 * "TodayPlanProgress" instead of dividing the width. Owning the Pressable
 * keeps `flex: 1`, the 56px target, the focus ring, and `role="tab"` inside
 * the bar's `tablist`.
 */
export function NavItemButton({ item, active, layout }: NavItemButtonProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const router = useRouter();
  const tint = active ? colors.green : colors.ink2;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      {...ariaState({ selected: active })}
      accessibilityLabel={item.label}
      onPress={() => router.replace(item.href)}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => ({
        flex: layout === 'bar' ? 1 : undefined,
        minHeight: NAV_ITEM_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xxs,
        paddingHorizontal: space.xs,
        backgroundColor: pressed ? colors.paper3 : 'transparent',
      })}
    >
      {/* Inset to 0: a ring drawn outside a bar item lands on its neighbour
          and is cut off by the bar's own edges. */}
      <FocusRing visible={focusVisible} inset={0} />
      <Glyph name={item.glyph} color={tint} />
      <Text variant="caption" color={active ? 'green' : 'ink2'}>
        {item.label}
      </Text>
    </Pressable>
  );
}
