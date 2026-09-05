/**
 * The pairing repair pass (R47 to R50, R68, R99, R121 to R125) and the
 * 8-exercise display cap (implementation checklist, page 11).
 *
 * A placed row is one exercise in one block with the slot's trim precedence.
 * The cap counts rendered rows: a grouped block is one row, and the warm-up
 * and cool-down groups are excluded outright.
 */
import type { ExerciseRole, MovementPattern, SessionBlockName } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';

/** One exercise placed in one block by one template slot. */
export interface PlacedRow {
  exercise: Exercise;
  block: SessionBlockName;
  role: ExerciseRole;
  /** Grouped blocks render as a single row. */
  grouped: boolean;
  /** Trim order: lowest first. */
  precedence: number;
  /** A pairing repair or a required slot: never trimmed. */
  required: boolean;
}

const LOWER_PATTERNS: readonly MovementPattern[] = ['squat', 'hinge', 'lunge'];
const KNEE_DOMINANT: readonly MovementPattern[] = ['squat', 'lunge'];

/**
 * The rows a pairing rule looks at. The warm-up is 2 to 4 mobility and
 * activation movements with no counted contacts (R29), so a glute bridge in it
 * is not the hinge R47 is talking about and must not trigger a repair.
 */
function counted(rows: readonly PlacedRow[]): PlacedRow[] {
  return rows.filter((row) => row.block !== 'warm_up');
}

/** One pairing rule as a trigger, a test and a repair. */
interface Pairing {
  id: string;
  text: string;
  triggered: (rows: readonly PlacedRow[]) => boolean;
  satisfied: (rows: readonly PlacedRow[]) => boolean;
  match: (exercise: Exercise) => boolean;
  role: ExerciseRole;
  block: SessionBlockName;
}

const some = (rows: readonly PlacedRow[], predicate: (exercise: Exercise) => boolean): boolean =>
  counted(rows).some((row) => predicate(row.exercise));

/**
 * R50 says "IF session contains a sagittal-plane movement THEN include a
 * frontal-plane or transverse-plane movement": it is satisfied by anything the
 * session contains, the warm-up included. Only the TRIGGER ignores the warm-up
 * (the declared reading for R47), so a session that already carries a banded
 * lateral walk and a 90-90 hip switch must never report the rule unmet.
 */
const someAnywhere = (
  rows: readonly PlacedRow[],
  predicate: (exercise: Exercise) => boolean,
): boolean => rows.some((row) => predicate(row.exercise));

const PAIRINGS: Pairing[] = [
  {
    id: 'push_needs_pull',
    text: 'a pull to balance the pressing',
    triggered: (rows) => some(rows, (e) => e.isPush),
    satisfied: (rows) => some(rows, (e) => e.isPull),
    match: (e) => e.isPull,
    role: 'accessory',
    block: 'accessory',
  },
  {
    id: 'hinge_needs_knee_dominant',
    text: 'a knee-dominant accessory beside the hinge',
    triggered: (rows) => some(rows, (e) => e.movementPattern === 'hinge'),
    satisfied: (rows) => some(rows, (e) => KNEE_DOMINANT.includes(e.movementPattern)),
    match: (e) => KNEE_DOMINANT.includes(e.movementPattern),
    role: 'accessory',
    block: 'accessory',
  },
  {
    id: 'hinge_needs_posterior_chain',
    text: 'a posterior-chain accessory',
    triggered: (rows) =>
      some(rows, (e) => e.movementPattern === 'hinge') ||
      some(rows, (e) => e.movementPattern === 'squat' && e.loadType === 'heavy_strength'),
    satisfied: (rows) => some(rows, (e) => e.rotationGroup === 'posterior_chain'),
    match: (e) => e.rotationGroup === 'posterior_chain',
    role: 'accessory',
    block: 'accessory',
  },
  {
    id: 'bilateral_needs_unilateral',
    text: 'a unilateral leg exercise beside the bilateral work',
    triggered: (rows) =>
      some(rows, (e) => !e.unilateral && LOWER_PATTERNS.includes(e.movementPattern)),
    satisfied: (rows) =>
      some(rows, (e) => e.unilateral && LOWER_PATTERNS.includes(e.movementPattern)),
    match: (e) => e.unilateral && LOWER_PATTERNS.includes(e.movementPattern),
    role: 'accessory',
    block: 'accessory',
  },
  {
    id: 'sagittal_needs_frontal_or_transverse',
    text: 'a frontal or transverse plane movement',
    triggered: (rows) => some(rows, (e) => e.plane === 'sagittal'),
    satisfied: (rows) => someAnywhere(rows, (e) => e.plane !== 'sagittal'),
    match: (e) => e.plane !== 'sagittal',
    role: 'accessory',
    block: 'accessory',
  },
  {
    id: 'sprints_need_hip_mobility',
    text: 'hip mobility after the sprint work',
    triggered: (rows) =>
      some(rows, (e) => e.movementPattern === 'sprint' || e.movementPattern === 'cod'),
    satisfied: (rows) => some(rows, (e) => e.rotationGroup === 'hip_mobility'),
    match: (e) => e.rotationGroup === 'hip_mobility',
    role: 'cool_down',
    block: 'cool_down',
  },
];

const TENDON_PAIRING: Pairing = {
  id: 'weekly_tendon_load',
  text: 'a tendon loading exercise',
  triggered: () => true,
  satisfied: (rows) => some(rows, (e) => e.tendonTarget !== undefined),
  match: (e) => e.tendonTarget !== undefined,
  role: 'tendon',
  block: 'accessory',
};

/** What the repair pass may add and how it picks among equals. */
export interface PairingOptions {
  /** R99: this session must carry the week's tendon work. */
  requireTendon: boolean;
  /**
   * R47 to R50 and R121 to R125, the structural balance rules. False on a
   * recovery day, which has no strength block for them to balance.
   */
  structural?: boolean;
  /** Caps (R23 to R25, R44, R67) the caller enforces. */
  canAdd: (exercise: Exercise) => boolean;
  /** Deterministic pick among equally good candidates. */
  choose: (candidates: readonly Exercise[], label: string) => Exercise | undefined;
  /** Precedence a repaired row carries. */
  repairPrecedence: number;
}

/**
 * The pairing rules as a repair pass: given a chosen list, add the smallest
 * set of exercises that satisfies R47 to R50, R68, R99 and R121 to R125, or
 * report which requirement could not be met with the athlete's inventory.
 */
export function satisfyPairings(
  rows: readonly PlacedRow[],
  pool: readonly Exercise[],
  options: PairingOptions,
): { rows: PlacedRow[]; unmet: string[] } {
  const out = rows.slice();
  const unmet: string[] = [];
  const structural = options.structural !== false ? PAIRINGS : [];
  const rules = options.requireTendon ? [...structural, TENDON_PAIRING] : structural;

  for (const rule of rules) {
    if (!rule.triggered(out)) continue;
    if (rule.satisfied(out)) continue;
    const chosen = new Set(out.map((row) => row.exercise.id));
    const candidates = pool
      .filter(
        (candidate) =>
          !chosen.has(candidate.id) &&
          candidate.roleCandidates.includes(rule.role) &&
          rule.match(candidate) &&
          options.canAdd(candidate),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const pick = options.choose(candidates, `pairing:${rule.id}`);
    if (pick === undefined) {
      unmet.push(rule.text);
      continue;
    }
    out.push({
      exercise: pick,
      block: rule.block,
      role: rule.role,
      grouped: rule.block === 'cool_down',
      precedence: options.repairPrecedence,
      required: true,
    });
  }
  return { rows: out, unmet };
}

/**
 * The pairing requirements that fire on this row list and are still met by it.
 * Used to protect a satisfying row from the display trim: R47 to R50 and R121
 * to R125 are Block 3 rules the 8-row checklist may not quietly undo.
 */
export function unmetPairings(
  rows: readonly PlacedRow[],
  options: Pick<PairingOptions, 'requireTendon' | 'structural'>,
): string[] {
  const structural = options.structural !== false ? PAIRINGS : [];
  const rules = options.requireTendon ? [...structural, TENDON_PAIRING] : structural;
  const out: string[] = [];
  for (const rule of rules) {
    if (!rule.triggered(rows)) continue;
    if (rule.satisfied(rows)) continue;
    out.push(rule.id);
  }
  return out;
}

/** Rendered rows the display cap counts. */
export function displayedRows(rows: readonly PlacedRow[]): number {
  const groupedBlocks = new Set<SessionBlockName>();
  let count = 0;
  for (const row of rows) {
    if (row.block === 'warm_up' || row.block === 'cool_down') continue;
    if (row.grouped) {
      if (groupedBlocks.has(row.block)) continue;
      groupedBlocks.add(row.block);
    }
    count += 1;
  }
  return count;
}

/**
 * Trim to at most 8 displayed rows, lowest precedence first, recording why
 * each row went. Required rows (main lift, the test, pairing repairs, the
 * weekly tendon exercise) are never trimmed.
 */
export function trimToDisplayCap(
  rows: readonly PlacedRow[],
  maxDisplayed: number,
  pairings?: Pick<PairingOptions, 'requireTendon' | 'structural'>,
): { rows: PlacedRow[]; trimmed: { exerciseId: string; reason: string }[] } {
  const out = rows.slice();
  const trimmed: { exerciseId: string; reason: string }[] = [];
  // A row placed by a template slot can be the only thing satisfying a
  // triggered pairing even though the repair pass never had to add it, so the
  // trim asks before it cuts and takes the next candidate down when it would
  // break one.
  while (displayedRows(out) > maxDisplayed) {
    const candidates: number[] = [];
    out.forEach((row, position) => {
      if (row.required) return;
      if (row.block === 'warm_up' || row.block === 'cool_down') return;
      candidates.push(position);
    });
    candidates.sort((a, b) => (out[a]?.precedence ?? 0) - (out[b]?.precedence ?? 0));
    const fallback = candidates[0] ?? -1;
    let index = -1;
    if (pairings !== undefined && fallback >= 0) {
      const before = unmetPairings(out, pairings).length;
      for (const position of candidates) {
        const after = unmetPairings(
          out.filter((_, at) => at !== position),
          pairings,
        ).length;
        if (after <= before) {
          index = position;
          break;
        }
      }
    } else index = fallback;
    if (index === -1) index = fallback;
    if (index === -1) break;
    const [removed] = out.splice(index, 1);
    if (removed === undefined) break;
    trimmed.push({
      exerciseId: removed.exercise.id,
      reason: `Trimmed to keep the session at ${maxDisplayed} exercises`,
    });
  }
  return { rows: out, trimmed };
}
