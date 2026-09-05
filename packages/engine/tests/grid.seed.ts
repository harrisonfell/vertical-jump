/**
 * The ruleset and exercise seed the grid runs against, loaded once and shared
 * by `grid.support.ts` and `grid.checks.ts`.
 */
import { loadExercises } from '../src/exercises/index.js';
import { loadRuleset } from '../src/ruleset/index.js';
import type { Ruleset } from '../src/types/ruleset.js';

export const gridRuleset: Ruleset = loadRuleset();
export const gridSeed = loadExercises();

/** Mon 7 Sep 2026: day 0 for every program on the grid. */
export const PROGRAM_START = '2026-09-07';
