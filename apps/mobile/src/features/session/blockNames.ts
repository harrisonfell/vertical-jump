import type { SessionExercise } from '@/data/types';

/**
 * Session blocks, in the words brief section 13 uses and the order rules R29
 * to R39 put them in. Warm-up and cool-down are grouped rows, never a list of
 * logged sets, so they read as one line each.
 */

const NAMES: Readonly<Record<string, string>> = {
  warm_up: 'Warm-up',
  primer: 'Primer',
  jump_test: 'Jump test',
  main_lift: 'Main lift',
  secondary: 'Secondary',
  power: 'Power',
  cod: 'COD',
  accessory: 'Accessory',
  injury_prevention_core: 'Injury prevention / core',
  conditioning: 'Conditioning',
  cool_down: 'Cool-down',
  recovery: 'Recovery',
};

const ORDER: readonly string[] = [
  'warm_up',
  'primer',
  'jump_test',
  'main_lift',
  'secondary',
  'power',
  'cod',
  'accessory',
  'injury_prevention_core',
  'conditioning',
  'cool_down',
  'recovery',
];

/** The block's name, or the raw key when a future ruleset adds one. */
export function blockName(block: string | null): string {
  if (block === null) return 'Session';
  return NAMES[block] ?? block;
}

/** Warm-up and cool-down render as one grouped row (R29, R39). */
export function isGrouped(block: string | null): boolean {
  return block === 'warm_up' || block === 'cool_down';
}

export interface ExerciseGroup {
  readonly key: string;
  readonly name: string;
  readonly grouped: boolean;
  readonly exercises: SessionExercise[];
}

/** Exercises grouped by block, in rule-book order. */
export function groupExercises(exercises: readonly SessionExercise[]): ExerciseGroup[] {
  const groups = new Map<string, SessionExercise[]>();
  for (const exercise of [...exercises].sort((a, b) => a.orderIndex - b.orderIndex)) {
    const key = exercise.block ?? 'session';
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [exercise]);
    else bucket.push(exercise);
  }

  const rank = (key: string): number => {
    const index = ORDER.indexOf(key);
    return index === -1 ? ORDER.length : index;
  };

  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([key, list]) => ({
      key,
      name: blockName(key === 'session' ? null : key),
      grouped: isGrouped(key),
      exercises: list,
    }));
}
