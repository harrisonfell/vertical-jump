/**
 * The disclosure chevron's turn, as plain values a style can take.
 *
 * It lives outside the component for the usual reason: the part that can be
 * wrong is the rule, not the rendering. It is also the part that was wrong.
 *
 * react-native-web 0.21 drops the `setNativeProps` path that React Native's
 * `Animated` uses to push a JS-driven value into a host component, so an
 * `Animated.Value` interpolated into `transform` renders once at its initial
 * value and never moves again: the chevron stayed at 0 degrees on the web
 * whatever the disclosure did, which read as a dead control. On the web the
 * turn is therefore a plain state-derived transform with a CSS transition,
 * which is what the platform is good at; native keeps `Animated`.
 */

import { EASE_OUT_QUART, duration } from '../motion';

/** Collapsed: the chevron points along the reading direction. */
export const CHEVRON_CLOSED = '0deg';
/** Open: a quarter turn, pointing at the content it revealed. */
export const CHEVRON_OPEN = '90deg';

/** The rotation a chevron carries for a given open state. */
export function chevronRotation(open: boolean): string {
  return open ? CHEVRON_OPEN : CHEVRON_CLOSED;
}

/** The three CSS longhands that animate the turn on the web. */
export interface ChevronTransition {
  readonly transitionProperty: string;
  readonly transitionDuration: string;
  readonly transitionTimingFunction: string;
}

/**
 * The web transition for the turn, or `null` when it must snap: reduced motion
 * asks for no transform animation at all, and the system answers by moving the
 * chevron instantly rather than by animating something else instead.
 */
export function chevronTransition(reduced: boolean): ChevronTransition | null {
  if (reduced) return null;
  return {
    transitionProperty: 'transform',
    transitionDuration: `${duration.base}ms`,
    transitionTimingFunction: `cubic-bezier(${EASE_OUT_QUART.join(', ')})`,
  };
}
