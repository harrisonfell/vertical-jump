import { indexById, loadExercises } from '@vert/engine';
import { isCategoryName, type CategoryName } from '@/ui';

/**
 * The exercise catalog's chart category, by exercise id.
 *
 * The category is an engine fact, not a stored one: it never enters the
 * database, so a screen that wants it reads the seeded catalog rather than a
 * column. The index is built once and kept, because `loadExercises` validates
 * every row on the way through and a session screen must not pay for that on
 * each render.
 */

let cached: ReadonlyMap<string, string> | null = null;

function categories(): ReadonlyMap<string, string> {
  if (cached === null) {
    const index = indexById(loadExercises().exercises);
    const map = new Map<string, string>();
    for (const [id, exercise] of index) map.set(id, exercise.categoryForCharts);
    cached = map;
  }
  return cached;
}

/**
 * The category to mark this exercise with, or undefined when the id is not one
 * the catalog knows. An unknown id draws no mark rather than a wrong one.
 */
export function categoryOf(exerciseId: string): CategoryName | undefined {
  const value = categories().get(exerciseId);
  if (value === undefined || !isCategoryName(value)) return undefined;
  return value;
}
