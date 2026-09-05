/**
 * Names, order, and grouping for the session's blocks.
 *
 * The words are brief section 13 "Vocabulary" verbatim. The order is the
 * engine's own: a materialized session already lists its blocks in the legal
 * placement order (R29 to R39), so the runner follows it rather than imposing
 * a second one. `CANONICAL_ORDER` is only the fallback for a session whose
 * snapshot is missing and which has to be rebuilt from its stored rows.
 */

/** The block names the engine emits. */
export type BlockName =
  | 'warm_up'
  | 'primer'
  | 'jump_test'
  | 'main_lift'
  | 'secondary'
  | 'accessory'
  | 'injury_prevention_core'
  | 'conditioning'
  | 'power'
  | 'cod'
  | 'recovery'
  | 'cool_down';

const BLOCK_LABELS: Readonly<Record<BlockName, string>> = {
  warm_up: 'Warm-up',
  primer: 'Primer',
  jump_test: 'Jump test',
  main_lift: 'Main lift',
  secondary: 'Secondary',
  accessory: 'Accessory',
  injury_prevention_core: 'Injury prevention / core',
  conditioning: 'Conditioning',
  power: 'Power',
  cod: 'COD',
  recovery: 'Recovery',
  cool_down: 'Cool-down',
};

/** Placement order for a session rebuilt from rows rather than a snapshot. */
export const CANONICAL_ORDER: readonly BlockName[] = [
  'warm_up',
  'primer',
  'jump_test',
  'main_lift',
  'secondary',
  'accessory',
  'injury_prevention_core',
  'conditioning',
  'power',
  'cod',
  'recovery',
  'cool_down',
];

export function isBlockName(value: string): value is BlockName {
  return Object.prototype.hasOwnProperty.call(BLOCK_LABELS, value);
}

export function blockLabel(name: string): string {
  return isBlockName(name) ? BLOCK_LABELS[name] : name;
}

export function blockOrder(name: string): number {
  const index = CANONICAL_ORDER.indexOf(name as BlockName);
  return index === -1 ? CANONICAL_ORDER.length : index;
}

/**
 * Warm-up and cool-down render as one collapsible group of movements with no
 * counted contacts (brief section 05). Every other block is a list of
 * exercises, because their reps are what the week is made of.
 */
export function isGroupedBlock(name: string): boolean {
  return name === 'warm_up' || name === 'cool_down';
}

/** The muted label beside an exercise name. "loaded jump" for ballistic. */
const LOAD_TYPE_LABELS: Readonly<Record<string, string>> = {
  heavy_strength: 'heavy strength',
  power: 'power',
  ballistic: 'loaded jump',
  hypertrophy: 'hypertrophy',
  endurance: 'endurance',
  speed_strength: 'speed strength',
  strength_speed: 'strength speed',
  prehab: 'prehab',
  mobility: 'mobility',
  bodyweight: 'bodyweight',
};

export function loadTypeLabel(loadType: string): string {
  return LOAD_TYPE_LABELS[loadType] ?? loadType.replace(/_/g, ' ');
}
