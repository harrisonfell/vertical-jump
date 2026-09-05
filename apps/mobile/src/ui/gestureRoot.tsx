import type { ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * The gesture root sheets and swipeable rows need on native. The web build
 * uses gestureRoot.web.tsx instead: react-native-gesture-handler touches
 * requestAnimationFrame at import time, which is absent during static
 * rendering in node.
 */
export function GestureRoot({ children }: { readonly children: ReactNode }) {
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;
}
