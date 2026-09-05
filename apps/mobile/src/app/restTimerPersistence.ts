import { useEffect } from 'react';
import { useDbOrNull } from '@/data';
import { KV_KEYS, kvStore } from '@/data/store';
import { hydrateRestTimer, setRestTimerStorage } from '@/state/session';

/**
 * Keeps the rest bar across a relaunch.
 *
 * The rest timer is the one piece of session UI that is not disposable. iOS
 * reclaims a backgrounded app hard, and a three minute rest with the screen off
 * is exactly when it happens; the athlete comes back to a runner with no bar
 * and no idea how long they have been standing there, while the notification
 * that would have told them is still queued and no longer cancellable.
 *
 * One kv row, written on start and stop, read once on boot. An expired rest is
 * dropped rather than resurrected, which `parseRestTimer` decides.
 */
export function useRestTimerPersistence(): void {
  const db = useDbOrNull();

  useEffect(() => {
    if (db === null) return;
    setRestTimerStorage({
      read: () => kvStore.kvGet(db, KV_KEYS.restTimer),
      write: async (value) => {
        if (value === null) await kvStore.kvDelete(db, KV_KEYS.restTimer);
        else await kvStore.kvSet(db, KV_KEYS.restTimer, value);
      },
    });

    void hydrateRestTimer();

    return () => {
      setRestTimerStorage(null);
    };
  }, [db]);
}
