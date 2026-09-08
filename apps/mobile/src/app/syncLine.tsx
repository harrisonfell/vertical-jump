import { Platform, View } from 'react-native';
import { useSyncSnapshot } from '@/state/sync';
import { Glyph, Text, space, useTheme, type ColorToken } from '@/ui';
import type { GlyphName } from '@/ui';
import { syncLineState, syncLineText, type SyncLineState } from './syncLineText';

/**
 * One line under the header on Today and Progress, or nothing.
 *
 * It is a live region: the athlete changes it by logging a set or walking out
 * of signal, so a screen reader should hear it change without being pulled to
 * it. When there is no server to sync to, it renders nothing at all rather than
 * claiming a state it cannot know.
 *
 * Two of its four states carry colour. A queue that is draining normally looks
 * like every other muted line, because that is the app working; a queue the
 * phone cannot drain takes `warn`, and one that has not drained in two days
 * takes `danger`, because at that point the only copy of a week of training
 * lives on a device in a chalk bag. The word is always there either way: the
 * colour changes how fast the line is found, never what it says.
 */

const TONE: Readonly<Record<SyncLineState, ColorToken>> = {
  synced: 'ink3',
  queued: 'ink3',
  offline: 'warn',
  stale: 'danger',
};

const GLYPH: Readonly<Record<SyncLineState, GlyphName | null>> = {
  synced: null,
  queued: null,
  offline: 'offline',
  stale: 'offline',
};

export function SyncLine({ testID }: { readonly testID?: string }) {
  const { colors } = useTheme();
  const snapshot = useSyncSnapshot();
  const input = {
    serverConfigured: snapshot.serverConfigured,
    online: snapshot.online,
    pending: snapshot.pending,
    oldestPendingAt: snapshot.oldestPendingAt,
    lastSyncedAt: snapshot.lastSyncedAt,
  };
  const line = syncLineText(input);
  const state = syncLineState(input);

  if (line === null || state === null) return null;

  const tone = TONE[state];
  const glyph = GLYPH[state];

  return (
    <View
      testID={testID ?? 'sync-line'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingBottom: space.sm,
      }}
      accessibilityLiveRegion="polite"
      {...(Platform.OS === 'web' ? { role: 'status' as const } : null)}
    >
      {glyph === null ? null : <Glyph name={glyph} color={colors[tone]} size={14} />}
      <Text variant={tone === 'ink3' ? 'caption' : 'captionStrong'} color={tone}>
        {line}
      </Text>
    </View>
  );
}

export {
  serverConfigured,
  syncLineState,
  syncLineText,
  type SyncLineInput,
  type SyncLineState,
} from './syncLineText';
