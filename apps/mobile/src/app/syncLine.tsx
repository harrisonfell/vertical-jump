import { Platform, View } from 'react-native';
import { useSyncSnapshot } from '@/state/sync';
import { Text, space } from '@/ui';
import { syncLineText } from './syncLineText';

/**
 * One muted line under the header on Today and Progress, or nothing.
 *
 * It is a live region: the athlete changes it by logging a set or walking out
 * of signal, so a screen reader should hear it change without being pulled to
 * it. When there is no server to sync to, it renders nothing at all rather than
 * claiming a state it cannot know.
 */

export function SyncLine({ testID }: { readonly testID?: string }) {
  const snapshot = useSyncSnapshot();
  const line = syncLineText({
    serverConfigured: snapshot.serverConfigured,
    online: snapshot.online,
    pending: snapshot.pending,
    oldestPendingAt: snapshot.oldestPendingAt,
    lastSyncedAt: snapshot.lastSyncedAt,
  });

  if (line === null) return null;

  return (
    <View
      testID={testID ?? 'sync-line'}
      style={{ paddingBottom: space.sm }}
      accessibilityLiveRegion="polite"
      {...(Platform.OS === 'web' ? { role: 'status' as const } : null)}
    >
      <Text variant="caption" color="ink3">
        {line}
      </Text>
    </View>
  );
}

export { serverConfigured, syncLineText, type SyncLineInput } from './syncLineText';
