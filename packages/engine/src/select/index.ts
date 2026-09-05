/**
 * Blocks 2 and 3: pick and order one session's exercises.
 *
 * Runs after Block 1 has excluded and capped (Rule 0) and after Block 4 and
 * Block 5 have set the week's volume, contact and progression targets. It
 * hands its result to Block 6, which never changes selection.
 *
 * Order inside a session (R29 to R40): warm-up first (2 to 4 mobility and
 * activation movements, 5 to 10 minutes, no counted contacts), primer, the
 * primary block by day type, then secondary strength, accessory, injury
 * prevention or core; conditioning after strength or power; cool-down last, or
 * cool-down then recovery. High-CNS and high-skill work early (R42, R43).
 *
 * Constraints it satisfies: at most 2 high-CNS exercises (R44); at most 2
 * knee-, spine- or shoulder-high exercises with their follow-ons (R23 to R25);
 * push needs pull (R48, R123); hinge needs a knee-dominant and a
 * posterior-chain accessory (R47, R68, R122); bilateral needs unilateral (R49,
 * R121); sagittal needs frontal or transverse (R50); sprints need hip mobility
 * (R125); a tendon loading exercise every week that survives deload, taper and
 * peak (R99); at most 8 displayed rows (implementation checklist).
 */
export * from './painGate.js';
export * from './filters.js';
export * from './order.js';
export * from './trim.js';
export * from './rotation.js';
export * from './sport.js';
export * from './assemble.js';
