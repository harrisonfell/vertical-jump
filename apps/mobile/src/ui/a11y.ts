import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/* --------------------------------------------------------- reduced motion */

/**
 * True when the athlete has asked the platform for less motion.
 *
 * Web reads the media query, native reads AccessibilityInfo. Both are read
 * inside an effect, never at module scope, because `npx expo export --platform
 * web` static-renders these components in node where `window` does not exist.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduced(query.matches);
      const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/* -------------------------------------------------------------- aria state */

// Re-exported so a component reaches for one a11y module. The rule itself is
// pure and lives next door, where a test can import it without react-native.
export {
  ariaState,
  describedBy,
  selectionState,
  type A11yState,
  type AriaState,
  type DescribedProps,
  type SelectableRole,
} from './ariaState';

/* ------------------------------------------------------- focus visibility */

type ModalityListener = (keyboard: boolean) => void;

const modalityListeners = new Set<ModalityListener>();
let keyboardModality = false;
let modalityInstalled = false;

function setModality(keyboard: boolean): void {
  if (keyboardModality === keyboard) return;
  keyboardModality = keyboard;
  for (const listener of modalityListeners) listener(keyboard);
}

/**
 * Installs the one pair of document listeners that decide whether the current
 * input modality is a keyboard. Called from an effect, so it never runs during
 * the static render pass.
 */
function installModalityWatcher(): void {
  if (modalityInstalled || typeof document === 'undefined') return;
  modalityInstalled = true;
  document.addEventListener('keydown', () => setModality(true), true);
  document.addEventListener('pointerdown', () => setModality(false), true);
  document.addEventListener('mousedown', () => setModality(false), true);
}

export interface FocusVisible {
  /** True only when this control holds focus and the athlete is on a keyboard. */
  readonly focusVisible: boolean;
  /** Spread onto a Pressable, TextInput, or View. */
  readonly focusProps: {
    readonly onFocus: () => void;
    readonly onBlur: () => void;
  };
}

/**
 * The focus-visible half of every interactive component. Pointer presses never
 * light the ring; a Tab or an arrow key always does.
 */
export function useFocusVisible(): FocusVisible {
  const [focused, setFocused] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    installModalityWatcher();
    const listener: ModalityListener = (value) => setKeyboard(value);
    modalityListeners.add(listener);
    setKeyboard(keyboardModality);
    return () => {
      modalityListeners.delete(listener);
    };
  }, []);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const focusProps = useMemo(() => ({ onFocus, onBlur }), [onFocus, onBlur]);

  return {
    focusVisible: focused && (Platform.OS !== 'web' || keyboard),
    focusProps,
  };
}

/* -------------------------------------------------------- roving tabindex */

/**
 * The tabIndex a member of a roving group should carry. One member is in the
 * tab order; the arrow keys move between the rest.
 */
export function rovingTabIndex(isActive: boolean): 0 | -1 {
  return isActive ? 0 : -1;
}

/** Moves an index inside a group, clamped at both ends (no wrap: no surprises). */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  const next = current + delta;
  if (next < 0) return 0;
  if (next > length - 1) return length - 1;
  return next;
}

/** Arrow, Home, and End keys mapped to a movement, or null when unhandled. */
export function keyToIndex(key: string, current: number, length: number): number | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return moveIndex(current, 1, length);
    case 'ArrowUp':
    case 'ArrowLeft':
      return moveIndex(current, -1, length);
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return null;
  }
}
