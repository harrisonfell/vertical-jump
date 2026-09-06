/**
 * @vert/engine: pure, deterministic training logic.
 * Nothing here may import from apps/. No React, no React Native.
 *
 * The ThisFiTT Rule Book v5 is king. Its own Rule 0 settles conflicts:
 * Block 1 Safety, then Block 4 Volume and CNS, then Block 5 Progression, then
 * Block 2 Structure, then Block 3 Selection, with Block 6 per-set loads
 * applied as a display layer after Blocks 1 to 5. Where brief section 09 names
 * a house rule or one of the four safety overrides, the named rule wins.
 * Every interpretation is shipped in `ruleset/ruleset.v1.json`.
 */
export const ENGINE_VERSION = '0.1.0';

export * from './units.js';
export * from './types.js';
export * from './prng.js';
export * from './level.js';
export * from './calendar.js';
export * from './budgets.js';
export * from './move.js';
export * from './materialize.js';
export * from './ruleset/index.js';
export * from './skeleton/index.js';
export * from './prescribe/index.js';
export * from './adherence/index.js';
export * from './select/index.js';
// The gym window the wall rules assume when the athlete has not said when they
// lift. Setup shows it beside the field, so the assumption is never silent.
export { ASSUMED_SESSION_WINDOW } from './select/rnt.js';
export * from './readiness/index.js';
export * from './exercises/index.js';
export * from './fixtures/index.js';
export * as analytics from './analytics/index.js';
