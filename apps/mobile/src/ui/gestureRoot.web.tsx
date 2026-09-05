import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Web has no gesture-handler root; pointer events reach the DOM directly. */
export function GestureRoot({ children }: { readonly children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
