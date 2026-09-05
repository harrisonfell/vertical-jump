/**
 * The session best. One test session yields one number for the trend, the PR,
 * and the chart: the best unflagged attempt. Flagged attempts (landed outside
 * the 18 in field, or read under the device's 6 in floor) are excluded here
 * once, so nothing downstream has to remember to filter them.
 */
import type { JumpTest } from '../types/analytics.js';

/** Best unflagged rep of a test session, in millimetres. Null when none. */
export function sessionBestMm(test: JumpTest): number | null {
  let best: number | null = null;
  for (const rep of test.reps) {
    if (rep.flagged) continue;
    if (best === null || rep.heightMm > best) best = rep.heightMm;
  }
  return best;
}

/** Every attempt in a session that counts, in millimetres, in rep order. */
export function sessionRepsMm(test: JumpTest): number[] {
  return test.reps.filter((rep) => !rep.flagged).map((rep) => rep.heightMm);
}

/**
 * The identity of a measurement stream: the instrument, its mode, and the
 * device and app versions. A change in any of them is a stream break, drawn on
 * the chart and never crossed by a PR (brief section 08 "PR threshold").
 */
export function streamKey(test: JumpTest): string {
  return [
    test.instrument,
    test.mode,
    test.deviceFirmware ?? '',
    test.ovrConnectVersion ?? '',
  ].join('|');
}
