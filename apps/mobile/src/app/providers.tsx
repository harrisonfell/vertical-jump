import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DbProvider } from '@/data/db';
import { useServerSync, useSnapshotSync } from '@/data/hooks';
import { useProjectionBackfill } from '@/features/plan/backfill';
import { useOnlineWatcher } from '@/state/sync';
import { GestureRoot } from '@/ui/gestureRoot';
import { useTheme } from '@/ui';
import { BootGate } from './boot';
import { ErrorBoundary } from './errorBoundary';
import { useRestTimerPersistence } from './restTimerPersistence';
import { AppThemeProvider, useThemeOverride } from './theme';

void SplashScreen.preventAutoHideAsync();

/**
 * The one global rule the web build needs.
 *
 * expo-router renders every Link as an anchor, so the browser's default link
 * colour lands on numbers inside pressable rows: week numbers, "4/4", "100%"
 * on Progress all came out in link blue, out of the ink palette and out of the
 * tabular column. Colour and decoration are the app's to set, always through a
 * token on the Text component.
 */
const WEB_RESET = 'a{color:inherit;text-decoration:none}';
const WEB_RESET_ID = 'vert-web-reset';

function useWebReset(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById(WEB_RESET_ID) !== null) return;
    const style = document.createElement('style');
    style.id = WEB_RESET_ID;
    style.textContent = WEB_RESET;
    document.head.appendChild(style);
  }, []);
}

/**
 * The five faces, mapped by the family names the Text component asks for.
 * Never `fontWeight`: the variable font is shipped as static instances, so a
 * weight the loader does not know about would silently fall back to a system
 * face.
 */
const FONTS = {
  'Archivo-Regular': require('../../assets/fonts/Archivo-Regular.ttf'),
  'Archivo-Medium': require('../../assets/fonts/Archivo-Medium.ttf'),
  'Archivo-SemiBold': require('../../assets/fonts/Archivo-SemiBold.ttf'),
  'Archivo-Bold': require('../../assets/fonts/Archivo-Bold.ttf'),
  ArchivoDisplay: require('../../assets/fonts/ArchivoDisplay-ExtraBold.ttf'),
} as const;

/**
 * True once the first frame may paint.
 *
 * The splash is held until the faces are in, so the first thing the athlete
 * sees is already Archivo rather than a system font that reflows under them.
 *
 * There is no splash to hold in node, though, and no font loader either:
 * `expo export --platform web` static-renders every route there, and a layout
 * that waits would export every page as an empty shell. No window means no
 * splash, so the tree renders and the export carries real markup.
 */
export function useAppFonts(): boolean {
  const [fontsLoaded, fontError] = useFonts(FONTS);
  return fontsLoaded || fontError !== null || typeof window === 'undefined';
}

/**
 * The longest the splash is ever held for the stored scheme.
 *
 * The read is one kv row behind the database opening, so in practice this
 * never fires. It exists because a splash that waits on a promise is a splash
 * that can wait forever, and a phone stuck on the launch image is worse than
 * one frame in the wrong scheme.
 */
const SPLASH_MAX_MS = 2000;

/**
 * Holds the launch image until the scheme is settled.
 *
 * The stored preference is a kv row, so it lands one tick after the database
 * opens; hiding the splash on the fonts alone meant a phone set to light on a
 * dark system painted the boot skeleton in charcoal and then flipped. The
 * splash is the honest thing to show for that tick.
 */
function useSplashUntil(ready: boolean): void {
  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
      return;
    }
    const timer = setTimeout(() => void SplashScreen.hideAsync(), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, [ready]);
}

/**
 * Safe areas, the status bar tuned to the scheme, and the two guards every
 * screen sits behind: the error boundary and the boot skeleton.
 *
 * `useProjectionBackfill` is the one piece of repair work that runs here. A
 * program built before the app projected past week 1 holds weeks 2..W as bare
 * rows no screen can open, and nothing else in the app would ever fill them.
 * It writes nothing when there is nothing to fill, which is every start after
 * the first.
 */
export function AppChrome({ children }: { readonly children: ReactNode }) {
  const { scheme } = useTheme();
  const { resolved } = useThemeOverride();
  useSplashUntil(resolved);
  useOnlineWatcher();
  useServerSync();
  useSnapshotSync();
  useWebReset();
  useRestTimerPersistence();
  useProjectionBackfill();

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ErrorBoundary>
        <BootGate>{children}</BootGate>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

/**
 * Provider order, outside in: gestures, the query cache, the database, then
 * the theme. The theme sits inside the database because the scheme override is
 * a kv row, and the chrome sits inside the theme so the very first frame is
 * already on paper.
 */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          // One retry, then show what is cached: the athlete is offline in a
          // gym often enough that a retry storm is worse than a stale number.
          queries: { retry: 1, staleTime: 30_000, gcTime: 86_400_000 },
        },
      }),
    [],
  );

  return (
    <GestureRoot>
      <QueryClientProvider client={queryClient}>
        <DbProvider>
          <AppThemeProvider>
            <AppChrome>{children}</AppChrome>
          </AppThemeProvider>
        </DbProvider>
      </QueryClientProvider>
    </GestureRoot>
  );
}
