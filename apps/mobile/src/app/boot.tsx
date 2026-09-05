import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useDbState } from '@/data';
import { Notice, Screen, Skeleton, space } from '@/ui';

/**
 * The first frame. Opening the database and running migrations takes a moment
 * on a cold start, and the honest thing to show is the shape of what is coming:
 * a header line and a few set rows on paper, at the heights they will really be,
 * so nothing jumps when the data lands.
 */

export function BootSkeleton() {
  return (
    <Screen testID="boot-skeleton">
      <View style={{ gap: space.lg }}>
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="strip" />
        <Skeleton skeletonFor="setRow" count={5} />
      </View>
    </Screen>
  );
}

export const BOOT_ERROR_COPY =
  'Could not open the training database on this phone. Close the app and open it again.';

function BootError() {
  return (
    <Screen testID="boot-error">
      <View style={{ paddingTop: space.lg }}>
        <Notice text="The app could not start" detail={BOOT_ERROR_COPY} />
      </View>
    </Screen>
  );
}

/**
 * Holds the router until migrations are done. Nothing under here may redirect
 * on missing data, because "missing" and "not read yet" look the same.
 */
export function BootGate({ children }: { readonly children: ReactNode }) {
  const { status } = useDbState();
  // The node static-render pass never runs effects, so the database never opens
  // there and every route would otherwise export as the boot skeleton.
  if (typeof window === 'undefined') return <>{children}</>;
  if (status === 'error') return <BootError />;
  if (status !== 'ready') return <BootSkeleton />;
  return <>{children}</>;
}
