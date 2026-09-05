import { Tabs } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { AppGateRoute } from '@/app';
import { NavRail } from '@/ui/navigation/navRail';
import { TabBar } from '@/ui/navigation/tabBar';
import { breakpoint, useTheme } from '@/ui/theme';

/**
 * Three destinations. On a phone or tablet they sit in the bottom bar; at
 * 1024px and up the bar is replaced by a left rail so the thumb reach that
 * justified the bar no longer costs vertical space.
 *
 * The gate wraps them: a first run has no program to show, so it sends the
 * athlete to setup before any tab mounts.
 */
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const rail = width >= breakpoint.desktop;

  return (
    <AppGateRoute>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.paper }}>
        {rail ? <NavRail /> : null}
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.paper } }}
            tabBar={rail ? () => null : () => <TabBar />}
          >
            <Tabs.Screen name="index" options={{ title: 'Today' }} />
            <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
            <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
          </Tabs>
        </View>
      </View>
    </AppGateRoute>
  );
}
