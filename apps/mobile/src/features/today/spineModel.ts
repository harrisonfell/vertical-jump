import type { SpineNodeState } from '@/ui';

/**
 * Which node on the session's spine is the current one.
 *
 * Exactly one: the first block or exercise that is not finished. The accent is
 * the scarcest thing in this system, and a spine that lit up every unfinished
 * node would spend it on a whole screen. Everything already logged reads as
 * done, everything after the current one is still to come.
 *
 * A node that is not `sequenced` sits on the spine but takes no part in the
 * decision. The jump test is the one of those: whether it has been logged is
 * known inside the test block's own query rather than by the runner, and a
 * node that can never report itself finished would hold the accent for the
 * whole session.
 */

export interface SpineItemState {
  readonly done: boolean;
  /** False for a node whose completion the runner cannot honestly read. */
  readonly sequenced: boolean;
}

export function nodeStates(items: readonly SpineItemState[]): SpineNodeState[] {
  const current = items.findIndex((item) => item.sequenced && !item.done);
  return items.map((item, index) => {
    if (item.sequenced && item.done) return 'done';
    return index === current ? 'current' : 'upcoming';
  });
}
