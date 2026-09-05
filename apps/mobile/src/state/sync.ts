import { useEffect } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { useSyncStatus } from '@/data/hooks';
import { serverConfigured } from '@/app/syncLineText';

/**
 * Whether the phone can reach anything, and how much is waiting.
 *
 * There is no NetInfo in this build, so connectivity is read two ways: the web
 * has `navigator.onLine` and its two events, and native infers it from the last
 * fetch that actually succeeded. Both are hints. Nothing on the daily path
 * waits on either of them: every tap writes locally first.
 */

export interface SyncUiState {
  readonly online: boolean;
  /** The last time a request to the server came back. Null until one does. */
  readonly lastOkAt: string | null;
  readonly lastFailureAt: string | null;

  setOnline(online: boolean): void;
  markSuccess(at?: string): void;
  markFailure(at?: string): void;
}

export const useSyncUiStore = create<SyncUiState>((set) => ({
  // Optimistic: an athlete in a basement gym is offline for a moment, not broken.
  online: true,
  lastOkAt: null,
  lastFailureAt: null,

  setOnline: (online) => set((state) => (state.online === online ? state : { online })),

  markSuccess: (at = new Date().toISOString()) =>
    set({ online: true, lastOkAt: at }),

  // Native has nothing to ask, so a failed fetch is the only offline signal.
  markFailure: (at = new Date().toISOString()) =>
    set({ online: false, lastFailureAt: at }),
}));

/**
 * Installs the web online and offline listeners once, inside an effect so the
 * static render pass never touches `window`. Native is left to markSuccess and
 * markFailure.
 */
export function useOnlineWatcher(): void {
  const setOnline = useSyncUiStore((state) => state.setOnline);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    setOnline(navigator.onLine !== false);
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [setOnline]);
}

export interface SyncSnapshot {
  readonly online: boolean;
  readonly pending: number;
  readonly oldestPendingAt: string | null;
  readonly lastSyncedAt: string | null;
  /** False in v1: no server is configured, so Settings says so plainly. */
  readonly serverConfigured: boolean;
}

/** Everything the sync line and the Settings row read, in one call. */
export function useSyncSnapshot(): SyncSnapshot {
  const status = useSyncStatus();
  const online = useSyncUiStore((state) => state.online);

  return {
    online,
    pending: status.data?.pending ?? 0,
    oldestPendingAt: status.data?.oldestPendingAt ?? null,
    lastSyncedAt: status.data?.lastSyncedAt ?? null,
    serverConfigured: serverConfigured(),
  };
}
