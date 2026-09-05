import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { remainingSeconds, restEndsAt, useSessionStore } from '@/state/session';

/**
 * The rest timer.
 *
 * The end is a timestamp, not a countdown, so the number is right after the
 * phone sleeps, the app is backgrounded, or the athlete walks to the rack and
 * back. A local notification covers the case where the app is not on screen at
 * all, and is cancelled the moment the next set is logged early. Haptics fire
 * only in the foreground on a device, because a buzz nobody asked for while
 * they are mid-lift is worse than no buzz.
 */

/** How the bar counts: once a second, from the stored end instant. */
export interface RestTimerState {
  readonly running: boolean;
  readonly remainingS: number;
  readonly nextLabel: string;
  readonly sessionId: string | null;
}

const NOTIFICATION_TITLE = 'Rest is up';

/**
 * The scheduled notification's id, held outside the component.
 *
 * The timer outlives every mount of the runner: finishing a session, opening
 * the done summary and coming back all unmount this hook while the rest is
 * still counting. A ref would die with the component and leave a notification
 * nothing can cancel, so the id lives beside the timer instead of inside the
 * screen that started it.
 */
let scheduledNotificationId: string | null = null;

async function scheduleEndNotification(seconds: number, body: string): Promise<string | null> {
  if (Platform.OS === 'web' || seconds < 5) return null;
  try {
    const Notifications = await import('expo-notifications');
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return null;
    }
    return await Notifications.scheduleNotificationAsync({
      content: { title: NOTIFICATION_TITLE, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(seconds),
      },
    });
  } catch {
    // A rest bar that counts is the promise; the notification is the courtesy.
    return null;
  }
}

async function cancelNotification(id: string | null): Promise<void> {
  if (id === null || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* nothing to cancel */
  }
}

async function buzz(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* haptics are optional hardware */
  }
}

export interface RestControls extends RestTimerState {
  /** Starts a rest and schedules its notification. */
  start(input: { seconds: number; label: string; sessionId: string }): void;
  /** Stops it and cancels the notification. Used by the bar and by a next tap. */
  stop(): void;
  /**
   * Renames the rest in place, keeping its end instant. A bulk log changes what
   * comes next without changing how long the athlete still waits.
   */
  relabel(label: string): void;
}

export function useRestTimer(): RestControls {
  const timer = useSessionStore((state) => state.restTimer);
  const startRest = useSessionStore((state) => state.startRest);
  const stopRest = useSessionStore((state) => state.stopRest);

  const [remaining, setRemaining] = useState(() =>
    timer === null ? 0 : remainingSeconds(timer.endsAt),
  );
  const buzzed = useRef(false);

  // One interval, recomputed from the end instant rather than decremented, so
  // a dropped tick or a backgrounded app cannot drift the number.
  useEffect(() => {
    if (timer === null) {
      setRemaining(0);
      buzzed.current = false;
      return;
    }
    const tick = (): void => setRemaining(remainingSeconds(timer.endsAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Coming back from the background recomputes immediately, before the next tick.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || timer === null) return;
      setRemaining(remainingSeconds(timer.endsAt));
    });
    return () => subscription.remove();
  }, [timer]);

  useEffect(() => {
    if (timer === null || remaining > 0 || buzzed.current) return;
    buzzed.current = true;
    if (AppState.currentState === 'active') void buzz();
  }, [remaining, timer]);

  const start = useCallback(
    ({ seconds, label, sessionId }: { seconds: number; label: string; sessionId: string }) => {
      void cancelNotification(scheduledNotificationId);
      scheduledNotificationId = null;
      buzzed.current = false;
      startRest({ endsAt: restEndsAt(seconds), nextLabel: label, sessionId });
      void scheduleEndNotification(seconds, label).then((id) => {
        scheduledNotificationId = id;
      });
    },
    [startRest],
  );

  const stop = useCallback(() => {
    void cancelNotification(scheduledNotificationId);
    scheduledNotificationId = null;
    buzzed.current = false;
    stopRest();
  }, [stopRest]);

  // The end instant and the notification are untouched: only the words change.
  const relabel = useCallback(
    (label: string) => {
      if (timer === null || timer.nextLabel === label) return;
      startRest({ endsAt: timer.endsAt, nextLabel: label, sessionId: timer.sessionId });
    },
    [startRest, timer],
  );

  return {
    running: timer !== null && remaining > 0,
    remainingS: remaining,
    nextLabel: timer?.nextLabel ?? '',
    sessionId: timer?.sessionId ?? null,
    start,
    stop,
    relabel,
  };
}

/**
 * Holds the screen awake while a session is running. A phone that locks between
 * sets costs a tap and a passcode with chalk on your hands.
 */
export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    let released = false;
    const tag = 'vert-session';

    void (async () => {
      try {
        const KeepAwake = await import('expo-keep-awake');
        if (released) return;
        await KeepAwake.activateKeepAwakeAsync(tag);
      } catch {
        /* keeping the screen on is a convenience, not a requirement */
      }
    })();

    return () => {
      released = true;
      void (async () => {
        try {
          const KeepAwake = await import('expo-keep-awake');
          await KeepAwake.deactivateKeepAwake(tag);
        } catch {
          /* already released */
        }
      })();
    };
  }, [active]);
}
