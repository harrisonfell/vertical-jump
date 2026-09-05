import { usePathname } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hairline } from '../primitives/hairline';
import { useTheme } from '../theme';
import { NAV_ITEMS, isActive } from './items';
import { NavItemButton } from './navItemButton';

/** The desktop replacement for the bottom bar: a 72px rail, same three items. */
export function NavRail() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  return (
    <View style={{ flexDirection: 'row' }}>
      <View
        accessibilityRole="tablist"
        style={{
          width: 72,
          backgroundColor: colors.paper2,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.lg,
          gap: space.xs,
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavItemButton
            key={item.href}
            item={item}
            active={isActive(item.href, pathname)}
            layout="rail"
          />
        ))}
      </View>
      <Hairline style={{ width: 1, height: '100%' }} />
    </View>
  );
}
