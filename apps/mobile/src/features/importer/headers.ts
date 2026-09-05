/**
 * The tolerant, header-keyed column mapper for OVR Connect exports.
 *
 * The real column schema is unverified until the first file arrives (brief
 * section 10 "OVR Connect and import"), so nothing here is positional. Every
 * column is matched by a normalised header against a list of aliases, the
 * sheet's kind is decided by which required fields were found, and anything
 * unmatched is reported by its original spelling so the manual mapping step
 * can say "Columns not recognized: Jump Height (cm), GCT".
 */

/** What one sheet of an export holds. */
export type SheetKind = 'jump' | 'velocity' | 'unknown';

/** Canonical jump-row fields. Height is one of three mutually exclusive units. */
export type JumpField =
  | 'date'
  | 'time'
  | 'heightIn'
  | 'heightCm'
  | 'contactTimeMs'
  | 'contactTimeS'
  | 'rsi'
  | 'mode'
  | 'attempt'
  | 'bodyweightLb'
  | 'bodyweightKg'
  | 'notes';

/** Canonical velocity-row fields. */
export type VelocityField =
  | 'date'
  | 'time'
  | 'exercise'
  | 'set'
  | 'rep'
  | 'loadLb'
  | 'loadKg'
  | 'meanVelocity'
  | 'peakVelocity'
  | 'romIn'
  | 'romCm'
  | 'powerW'
  | 'notes';

export type CanonicalField = JumpField | VelocityField;

/**
 * Aliases per field, already normalised. Matching is exact against the
 * normalised header first, then a contains test, so "Jump Height (in)" and
 * "height_in" both land on `heightIn` while "Peak Height" does not steal it.
 */
const JUMP_ALIASES: Readonly<Record<JumpField, readonly string[]>> = {
  date: ['date', 'session date', 'test date', 'day', 'timestamp', 'date time'],
  time: ['time', 'time of day', 'start time'],
  heightIn: ['height in', 'jump height in', 'jump height inches', 'height inches', 'inches', 'height'],
  heightCm: ['height cm', 'jump height cm', 'jump height centimeters', 'height centimeters', 'cm'],
  contactTimeMs: [
    'contact time ms',
    'ground contact time ms',
    'gct ms',
    'gct',
    'contact time',
    'ground contact time',
  ],
  contactTimeS: ['contact time s', 'gct s', 'contact time seconds'],
  rsi: ['rsi', 'reactive strength index'],
  mode: ['mode', 'test mode', 'device mode'],
  attempt: ['attempt', 'rep', 'jump', 'jump number', 'attempt number', 'rep number'],
  bodyweightLb: ['bodyweight lb', 'body weight lb', 'weight lb', 'bodyweight lbs'],
  bodyweightKg: ['bodyweight kg', 'body weight kg', 'weight kg'],
  notes: ['notes', 'note', 'comment', 'comments'],
};

const VELOCITY_ALIASES: Readonly<Record<VelocityField, readonly string[]>> = {
  date: ['date', 'session date', 'day', 'timestamp', 'date time'],
  time: ['time', 'time of day', 'start time'],
  exercise: ['exercise', 'lift', 'movement', 'exercise name'],
  set: ['set', 'set number', 'set index'],
  rep: ['rep', 'rep number', 'repetition', 'rep index'],
  loadLb: ['load lb', 'weight lb', 'load lbs', 'weight lbs', 'load pounds'],
  loadKg: ['load kg', 'weight kg', 'load kilograms', 'load'],
  meanVelocity: [
    'mean velocity',
    'avg velocity',
    'average velocity',
    'mean velocity m s',
    'mean concentric velocity',
    'velocity',
  ],
  peakVelocity: ['peak velocity', 'max velocity', 'peak velocity m s'],
  romIn: ['rom in', 'range of motion in', 'rom inches'],
  romCm: ['rom cm', 'range of motion cm', 'rom centimeters', 'rom'],
  powerW: ['power w', 'avg power', 'average power', 'mean power', 'power', 'peak power'],
  notes: ['notes', 'note', 'comment', 'comments'],
};

/**
 * Lowercase, strip units punctuation, collapse whitespace. "Mean Velocity
 * (m/s)" becomes "mean velocity m s"; "GCT_ms" becomes "gct ms".
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[_\-/\\.,#:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The mapping a sheet resolved to: canonical field to the original header. */
export type ColumnMapping = Readonly<Partial<Record<CanonicalField, string>>>;

export interface MappingResult {
  readonly kind: SheetKind;
  readonly mapping: ColumnMapping;
  /** Headers, as spelled in the file, that no field claimed. */
  readonly unrecognized: readonly string[];
  /** Canonical fields the sheet's kind needs and did not find. */
  readonly missing: readonly CanonicalField[];
}

function aliasesFor(kind: 'jump' | 'velocity'): Readonly<Record<string, readonly string[]>> {
  return kind === 'jump' ? JUMP_ALIASES : VELOCITY_ALIASES;
}

/**
 * Score one header against one field's aliases. An exact match beats a
 * contains match, and a longer alias beats a shorter one, so "height cm" is
 * never taken by the bare "height" alias of `heightIn`.
 */
function score(normalized: string, aliases: readonly string[]): number {
  let best = 0;
  for (const alias of aliases) {
    if (normalized === alias) best = Math.max(best, 1000 + alias.length);
    else if (normalized.includes(alias)) best = Math.max(best, alias.length);
  }
  return best;
}

function mapForKind(headers: readonly string[], kind: 'jump' | 'velocity'): MappingResult {
  const aliases = aliasesFor(kind);
  const fields = Object.keys(aliases);
  const claimed = new Map<string, { header: string; score: number }>();
  const unrecognized: string[] = [];

  for (const header of headers) {
    if (header === '') continue;
    const normalized = normalizeHeader(header);
    let bestField: string | null = null;
    let bestScore = 0;
    for (const field of fields) {
      const value = score(normalized, aliases[field] ?? []);
      if (value > bestScore) {
        bestScore = value;
        bestField = field;
      }
    }
    if (bestField === null) {
      unrecognized.push(header);
      continue;
    }
    const held = claimed.get(bestField);
    if (held === undefined || bestScore > held.score) {
      if (held !== undefined) unrecognized.push(held.header);
      claimed.set(bestField, { header, score: bestScore });
    } else {
      unrecognized.push(header);
    }
  }

  const mapping: Partial<Record<CanonicalField, string>> = {};
  for (const [field, held] of claimed) mapping[field as CanonicalField] = held.header;

  const missing = requiredFor(kind).filter((field) => mapping[field] === undefined);
  return { kind, mapping, unrecognized, missing };
}

/** What a sheet must have before its rows can be read at all. */
export function requiredFor(kind: 'jump' | 'velocity'): CanonicalField[] {
  return kind === 'jump' ? ['date'] : ['date', 'exercise'];
}

/** True when the mapping has a usable height column. */
function hasHeight(mapping: ColumnMapping): boolean {
  return mapping.heightIn !== undefined || mapping.heightCm !== undefined;
}

/** True when the mapping has a usable velocity column. */
function hasVelocity(mapping: ColumnMapping): boolean {
  return mapping.meanVelocity !== undefined || mapping.peakVelocity !== undefined;
}

/**
 * Decide what a sheet is and how to read it. A velocity sheet is recognised by
 * an exercise column beside a velocity column; a jump sheet by a height column.
 * Anything else is `unknown` and routes to the manual mapping step.
 */
export function mapSheet(headers: readonly string[]): MappingResult {
  const asVelocity = mapForKind(headers, 'velocity');
  if (asVelocity.mapping.exercise !== undefined && hasVelocity(asVelocity.mapping)) {
    return asVelocity;
  }

  const asJump = mapForKind(headers, 'jump');
  if (hasHeight(asJump.mapping)) return asJump;

  return {
    kind: 'unknown',
    mapping: {},
    unrecognized: headers.filter((header) => header !== ''),
    missing: [],
  };
}

/**
 * Apply a manual mapping on top of an automatic one. The manual step hands
 * back canonical field to original header, and only fields the athlete chose
 * are overwritten, so a partly recognised sheet keeps what it already knew.
 */
export function applyManualMapping(
  base: MappingResult,
  chosen: Readonly<Partial<Record<CanonicalField, string>>>,
  headers: readonly string[],
): MappingResult {
  const mapping: Partial<Record<CanonicalField, string>> = { ...base.mapping };
  for (const [field, header] of Object.entries(chosen)) {
    if (header !== undefined && header !== '') mapping[field as CanonicalField] = header;
  }

  const kind: SheetKind =
    mapping.exercise !== undefined && hasVelocity(mapping)
      ? 'velocity'
      : hasHeight(mapping)
        ? 'jump'
        : 'unknown';

  const used = new Set(Object.values(mapping));
  const unrecognized = headers.filter((header) => header !== '' && !used.has(header));
  const missing = kind === 'unknown' ? [] : requiredFor(kind).filter((f) => mapping[f] === undefined);

  return { kind, mapping, unrecognized, missing };
}

/** "Columns not recognized: Jump Height (cm), GCT" (brief section 06). */
export function unrecognizedLine(unrecognized: readonly string[]): string | null {
  if (unrecognized.length === 0) return null;
  return `Columns not recognized: ${unrecognized.join(', ')}`;
}
