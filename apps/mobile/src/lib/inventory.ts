/**
 * The equipment inventory: read, written, and read back as one summary line.
 *
 * R19 excludes any exercise whose equipment is absent, and R45 and R46 gate
 * the barbell compounds on `weightRoomAccess`, which is derived from barbell
 * plus rack plus plates and never asked. Collected once; the generator cannot
 * select a single exercise without it.
 */
import type { Inventory } from '@vert/engine';
import { formatInteger } from '@vert/engine';
import type { Json } from '@/data';

/** What a gym with a rack and a full rounded rack of plates looks like. */
export const DEFAULT_INVENTORY: Inventory = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: false,
  dumbbells: { maxLb: 50, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24],
  hurdleHeightsIn: [],
  bands: false,
  medBall: false,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
  hangboard: false,
  boxSquatBox: false,
  climbingWall: false,
  weightRoomAccess: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function bool(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function heights(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out = value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry > 0,
  );
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Derived, never asked: barbell and rack and a plate pair. */
export function weightRoomAccess(inventory: Inventory): boolean {
  return inventory.barbell && inventory.rack && inventory.plates.smallestPairLb > 0;
}

/** The stored JSON as a structured inventory, or null when nothing is stored. */
export function readInventory(value: Json): Inventory | null {
  if (!isRecord(value)) return null;
  const plates = isRecord(value['plates']) ? value['plates'] : {};
  const dumbbells = isRecord(value['dumbbells']) ? value['dumbbells'] : null;
  const vestLb = value['vestLb'];

  const inventory: Inventory = {
    barbell: bool(value, 'barbell', false),
    rack: bool(value, 'rack', false),
    plates: { smallestPairLb: positive(plates['smallestPairLb'], 5) },
    trapBar: bool(value, 'trapBar', false),
    dumbbells:
      dumbbells === null
        ? null
        : {
            maxLb: positive(dumbbells['maxLb'], 50),
            incrementLb: positive(dumbbells['incrementLb'], 5),
          },
    kettlebells: bool(value, 'kettlebells', false),
    boxHeightsIn: heights(value['boxHeightsIn']),
    hurdleHeightsIn: heights(value['hurdleHeightsIn']),
    bands: bool(value, 'bands', false),
    medBall: bool(value, 'medBall', false),
    bench: bool(value, 'bench', false),
    pullupBar: bool(value, 'pullupBar', false),
    cable: bool(value, 'cable', false),
    sled: bool(value, 'sled', false),
    // The three climbing answers. Absent reads as false, so an athlete who
    // never saw the question keeps the inventory they already had.
    hangboard: bool(value, 'hangboard', false),
    boxSquatBox: bool(value, 'boxSquatBox', false),
    climbingWall: bool(value, 'climbingWall', false),
    weightRoomAccess: false,
  };
  if (typeof vestLb === 'number' && Number.isFinite(vestLb) && vestLb > 0) {
    inventory.vestLb = vestLb;
  }
  return { ...inventory, weightRoomAccess: weightRoomAccess(inventory) };
}

function heightList(values: readonly number[], unit: string): string | null {
  if (values.length === 0) return null;
  return `${values.map((value) => formatInteger(value)).join(', ')} ${unit}`;
}

/**
 * The summary line beside Edit. It names what is there, so an absent item is
 * read by its absence rather than by a list of nos.
 */
export function inventorySummary(inventory: Inventory): string {
  const parts: string[] = [];
  if (inventory.barbell) {
    parts.push(
      inventory.rack
        ? `barbell and rack, ${formatInteger(inventory.plates.smallestPairLb)} lb plates`
        : `barbell, ${formatInteger(inventory.plates.smallestPairLb)} lb plates`,
    );
  }
  if (inventory.trapBar) parts.push('trap bar');
  if (inventory.dumbbells !== null) {
    parts.push(
      `dumbbells to ${formatInteger(inventory.dumbbells.maxLb)} lb in ${formatInteger(inventory.dumbbells.incrementLb)} lb steps`,
    );
  }
  if (inventory.kettlebells) parts.push('kettlebells');
  const boxes = heightList(inventory.boxHeightsIn, 'in boxes');
  if (boxes !== null) parts.push(boxes);
  const hurdles = heightList(inventory.hurdleHeightsIn, 'in hurdles');
  if (hurdles !== null) parts.push(hurdles);
  if (inventory.bands) parts.push('bands');
  if (inventory.medBall) parts.push('med ball');
  if (inventory.vestLb !== undefined) parts.push(`${formatInteger(inventory.vestLb)} lb vest`);
  if (inventory.bench) parts.push('bench');
  if (inventory.pullupBar) parts.push('pull-up bar');
  if (inventory.cable) parts.push('cable');
  if (inventory.sled) parts.push('sled');
  if (inventory.boxSquatBox === true) parts.push('box squat box');
  if (inventory.hangboard === true) parts.push('hangboard');
  if (inventory.climbingWall === true) parts.push('climbing wall');

  if (parts.length === 0) return 'Nothing on hand yet. Bodyweight work only.';
  return `${parts.join(' · ')}.`;
}
