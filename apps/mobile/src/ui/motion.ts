/**
 * Motion tokens.
 *
 * Motion conveys state and nothing else: a sheet arriving, a disclosure
 * opening, a skeleton breathing. There is no decorative motion in this system,
 * no celebration, no orchestration. Everything lands inside 250 ms.
 */

/** Durations in milliseconds. Nothing outside this set. */
export const duration = {
  /** Instant feedback: a press, a tone change. */
  fast: 150,
  /** State changes: a disclosure, a chip selection. */
  base: 200,
  /** The largest move the system makes: a sheet sliding up. */
  sheet: 250,
} as const;

/** The single easing curve, as its cubic-bezier control points. */
export const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const;

/**
 * Ease-out-quart as a plain progress function, which is what
 * `Animated.timing` wants for `easing`. Matches cubic-bezier(0.25, 1, 0.5, 1)
 * closely enough that no one can tell, and needs no import from react-native.
 */
export function easeOutQuart(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - clamped) ** 4;
}

/** One full cycle of the skeleton's opacity breath. */
export const SKELETON_CYCLE_MS = 1400;

/** Opacity bounds for the skeleton breath. Never fully transparent. */
export const SKELETON_OPACITY = { from: 0.45, to: 0.85 } as const;

/** How long the landing prompt waits before it defaults to Good. */
export const LANDING_PROMPT_SECONDS = 5;

export type DurationToken = keyof typeof duration;
