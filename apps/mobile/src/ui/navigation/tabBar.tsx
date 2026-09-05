import { usePathname } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hairline } from '../primitives/hairline';
import { breakpoint, useTheme } from '../theme';
import { NAV_ITEMS, isActive } from './items';
import { NavItemButton } from './navItemButton';

/**
 * The bottom bar: three destinations, glyph plus text, on the second neutral
 * with a hairline above it. No default icons, no badges, no ripple.
 */
export function TabBar() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  return (
    <View style={{ backgroundColor: colors.paper2 }}>
      <Hairline />
      {/* The items carry the height (56 each) and divide the width between
          them; the bar adds only the home indicator's safe area beneath. */}
      <View style={width >= breakpoint.tablet ? { width: '100%', maxWidth: 480, alignSelf: 'center' } : undefined}>
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            paddingBottom: insets.bottom,
          }}
        >
          {NAV_ITEMS.map((item) => (
            <NavItemButton
              key={item.href}
              item={item}
              active={isActive(item.href, pathname)}
              layout="bar"
            />
          ))}
        </View>
      </View>
    </View>
  );
}
