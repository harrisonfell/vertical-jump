/**
 * @vert/engine/analytics: Theil-Sen trend, the five pace states, PR
 * thresholds, the noise floor, and the projection band. Every jump number
 * belongs to an instrument stream; streams never share a trend line, a PR, or
 * an axis (brief section 08).
 *
 * Also here: the chart's fixed domains and broken segments, the weekly review
 * line, the recovery-versus-output table, the autoregulation gate, and jump
 * readiness from RSI-mode reps.
 */
export const ANALYTICS_VERSION = '0.1.0';

export * from './format.js';
export * from './theilSen.js';
export * from './noise.js';
export * from './calibration.js';
export * from './pr.js';
export * from './projection.js';
export * from './pace.js';
export * from './chart.js';
export * from './review.js';
export * from './recovery.js';
export * from './gate.js';
export * from './readiness.js';
export * from './asymmetry.js';
export * from './sideEffort.js';
