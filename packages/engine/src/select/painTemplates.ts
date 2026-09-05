/**
 * The per-location pain templates. R3 to R18 for knee, shin, back, shoulder
 * and Achilles; hamstring, hip and other use the house templates named in the
 * ruleset (`house.pain_hamstring`, `house.pain_hip`, `house.pain_other`).
 *
 * The joint-stress exclusions R20 to R22 apply at any severity, so each
 * handler sets its joint flag before it branches on severity.
 */
import { findHouseRule } from '../ruleset/index.js';
import type { MovementPattern, PainLocation, PainSeverity, TendonTarget } from '../types/core.js';
import type { CappedAttribute, PainExclusions, PainVolumeCuts } from '../types/pain.js';
import type { HouseRule, Ruleset } from '../types/ruleset.js';
import type { AttributeCap, PatternCap, RequiredWeeklyWork } from './painGate.js';

const LOCATION_PHRASE: Record<PainLocation, string> = {
  knee: 'knee pain',
  shin: 'shin pain',
  back: 'back pain',
  shoulder: 'shoulder pain',
  achilles_calf: 'Achilles or calf pain',
  hamstring: 'hamstring pain',
  hip: 'hip pain',
  finger: 'finger pain',
  other: 'pain at another site',
};

const SEVERE_CONSEQUENCE: Record<PainLocation, string> = {
  knee: 'The rule book excludes all knee-stress lifts and all jumps at this level, including the weekly test.',
  shin: 'The rule book excludes all repetitive impact work at this level, including sprints, pogos and the weekly test.',
  back: 'The rule book excludes all axial loading and all spine-stress lifts at this level.',
  shoulder: 'The rule book excludes all overhead and pressing work at this level.',
  achilles_calf: 'The rule book excludes all plyometrics at this level, including the weekly test.',
  hamstring: 'The house rule excludes sprinting, maximal jumps and loaded hinges at this level, including the weekly test.',
  hip: 'The house rule excludes deep squatting, sprinting and jumping at this level, including the weekly test.',
  finger: 'The house rule excludes all pulling and hanging work at this level.',
  other: 'The house rule removes maximal work everywhere at this level.',
};

/** The exact sentence the clearance screen shows (brief section 13). */
export function severePainSentence(location: PainLocation): string {
  return [
    'Medical clearance needed.',
    `You reported ${LOCATION_PHRASE[location]} at 5+ (limits training).`,
    SEVERE_CONSEQUENCE[location],
    'Get it assessed.',
  ].join(' ');
}

/** The self-screen sentence (brief section 05 "Medical clearance"). */
export const SELF_SCREEN_SENTENCE =
  'Medical clearance needed. You answered yes to a screening question. No program is built until a clinician clears you.';

export function emptyExclusions(): PainExclusions {
  return {
    kneeHigh: false,
    spineHigh: false,
    shoulderHigh: false,
    allPlyo: false,
    highIntensityPlyo: false,
    highImpactPlyo: false,
    repetitiveImpact: false,
    overhead: false,
    pressing: false,
    axialHeavy: false,
    axialAll: false,
    allKneeStress: false,
    allSpineStress: false,
    excludedPatterns: [],
  };
}

/** Mutable accumulator so each location handler stays a few lines long. */
export interface Accumulator {
  exclusions: PainExclusions;
  attributeCaps: AttributeCap[];
  patternCaps: PatternCap[];
  volumeCuts: PainVolumeCuts;
  tendonProtocols: TendonTarget[];
  requiredWeekly: RequiredWeeklyWork[];
  lines: string[];
  houseRules: HouseRule[];
  severe: PainLocation | null;
}

export function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

export function capAttribute(acc: Accumulator, attribute: CappedAttribute, pct: number, reason: string): void {
  const existing = acc.attributeCaps.find((entry) => entry.attribute === attribute);
  if (existing === undefined) {
    acc.attributeCaps.push({ attribute, pct, reason });
    return;
  }
  if (pct < existing.pct) {
    existing.pct = pct;
    existing.reason = reason;
  }
}

function capPatterns(acc: Accumulator, patterns: MovementPattern[], pct: number, reason: string): void {
  acc.patternCaps.push({ patterns, pct, reason });
}

function houseTemplate(acc: Accumulator, ruleset: Ruleset, id: string): void {
  const rule = findHouseRule(ruleset, id);
  if (rule !== undefined) acc.houseRules.push(rule);
}

export function applyKnee(acc: Accumulator, severity: PainSeverity, pct: number, factor: number): void {
  // R20 applies at any severity: no exercise tagged knee stress high.
  acc.exclusions.kneeHigh = true;
  if (severity === 'severe') {
    acc.exclusions.allKneeStress = true;
    acc.exclusions.allPlyo = true;
    acc.severe = 'knee';
    acc.lines.push('Knee pain at 5+: every knee-stress lift and every jump is out, including the weekly test.');
    return;
  }
  pushUnique(acc.tendonProtocols, 'knee');
  pushUnique(acc.requiredWeekly, 'knee_prehab');
  if (severity === 'moderate') {
    acc.volumeCuts.highIntensityFactor = Math.min(acc.volumeCuts.highIntensityFactor ?? 1, factor);
    acc.lines.push('Moderate knee pain: nothing that loads the knee hard, half the high-intensity jump contacts, knee prehab every week.');
    return;
  }
  capAttribute(acc, 'knee_stress', pct, 'mild knee pain');
  acc.lines.push('Mild knee pain: knee-stress work stays moderate and capped at 80 percent, with the knee tendon protocol every week.');
}

export function applyShin(acc: Accumulator, severity: PainSeverity, moderatePct: number, mildPct: number): void {
  if (severity === 'severe') {
    acc.exclusions.repetitiveImpact = true;
    acc.exclusions.allPlyo = true;
    acc.severe = 'shin';
    acc.lines.push('Shin pain at 5+: all repetitive impact work is out, including sprints, pogos and the weekly test.');
    return;
  }
  pushUnique(acc.tendonProtocols, 'calf');
  pushUnique(acc.requiredWeekly, 'calf_tendon');
  if (severity === 'moderate') {
    acc.exclusions.highImpactPlyo = true;
    acc.volumeCuts.pogoSprintPct = Math.max(acc.volumeCuts.pogoSprintPct ?? 0, moderatePct);
    acc.lines.push('Moderate shin pain: no high-impact plyometrics, and pogo and sprint volume cut by half.');
    return;
  }
  acc.volumeCuts.pogoSprintPct = Math.max(acc.volumeCuts.pogoSprintPct ?? 0, mildPct);
  acc.lines.push('Mild shin pain: pogo and sprint volume cut by a quarter, with calf tendon work every week.');
}

export function applyBack(acc: Accumulator, severity: PainSeverity, pct: number): void {
  // R21 applies at any severity.
  acc.exclusions.spineHigh = true;
  if (severity === 'severe') {
    acc.exclusions.axialAll = true;
    acc.exclusions.allSpineStress = true;
    acc.severe = 'back';
    acc.lines.push('Back pain at 5+: all axial loading and every spine-stress lift is out.');
    return;
  }
  if (severity === 'moderate') {
    acc.exclusions.axialHeavy = true;
    acc.lines.push('Moderate back pain: no spine-stress lift and no heavy axial loading.');
    return;
  }
  capAttribute(acc, 'axial_load', pct, 'mild back pain');
  pushUnique(acc.requiredWeekly, 'core_stability');
  acc.lines.push('Mild back pain: axial loading capped at 80 percent, with core stability work every week.');
}

export function applyShoulder(acc: Accumulator, severity: PainSeverity, pct: number): void {
  // R22 applies at any severity.
  acc.exclusions.shoulderHigh = true;
  if (severity === 'severe') {
    acc.exclusions.overhead = true;
    acc.exclusions.pressing = true;
    acc.severe = 'shoulder';
    acc.lines.push('Shoulder pain at 5+: all overhead and pressing work is out.');
    return;
  }
  if (severity === 'moderate') {
    acc.exclusions.overhead = true;
    acc.lines.push('Moderate shoulder pain: no shoulder-stress lift and no overhead pressing.');
    return;
  }
  capAttribute(acc, 'pressing', pct, 'mild shoulder pain');
  pushUnique(acc.requiredWeekly, 'scapular_stability');
  acc.lines.push('Mild shoulder pain: pressing capped at 80 percent, with scapular stability work every week.');
}

export function applyAchilles(acc: Accumulator, severity: PainSeverity): void {
  pushUnique(acc.tendonProtocols, 'achilles');
  if (severity === 'severe') {
    acc.exclusions.allPlyo = true;
    acc.severe = 'achilles_calf';
    acc.lines.push('Achilles or calf pain at 5+: all plyometrics are out, including the weekly test.');
    return;
  }
  if (severity === 'moderate') {
    acc.exclusions.highIntensityPlyo = true;
    pushUnique(acc.requiredWeekly, 'calf_tendon');
    acc.lines.push('Moderate Achilles pain: no high-intensity plyometrics, isometric tendon loading first, and the tendon runway sets the pace.');
    return;
  }
  acc.volumeCuts.intensityTierDown = true;
  pushUnique(acc.tendonProtocols, 'calf');
  pushUnique(acc.requiredWeekly, 'calf_tendon');
  acc.lines.push('Mild Achilles pain: plyometrics drop one intensity tier, with calf and Achilles tendon work every week.');
}

export function applyHamstring(acc: Accumulator, severity: PainSeverity, ruleset: Ruleset, pct: number): void {
  houseTemplate(acc, ruleset, 'house.pain_hamstring');
  pushUnique(acc.requiredWeekly, 'hamstring_eccentric');
  if (severity === 'severe') {
    pushUnique(acc.exclusions.excludedPatterns, 'sprint');
    pushUnique(acc.exclusions.excludedPatterns, 'hinge');
    acc.exclusions.highIntensityPlyo = true;
    acc.severe = 'hamstring';
    acc.lines.push('Hamstring pain at 5+: sprinting, maximal jumps and loaded hinges are out. House rule.');
    return;
  }
  if (severity === 'moderate') {
    pushUnique(acc.exclusions.excludedPatterns, 'sprint');
    acc.lines.push('Moderate hamstring pain: no maximal sprints, hinge loads capped at 80 percent, eccentric hamstring work every week. House rule.');
  } else {
    acc.lines.push('Mild hamstring pain: hinge loads capped at 80 percent, eccentric hamstring work every week. House rule.');
  }
  capPatterns(acc, ['hinge'], pct, 'hamstring pain, house rule');
}

export function applyHip(acc: Accumulator, severity: PainSeverity, ruleset: Ruleset, pct: number): void {
  houseTemplate(acc, ruleset, 'house.pain_hip');
  pushUnique(acc.requiredWeekly, 'hip_mobility');
  if (severity === 'severe') {
    pushUnique(acc.exclusions.excludedPatterns, 'sprint');
    pushUnique(acc.exclusions.excludedPatterns, 'jump');
    acc.exclusions.kneeHigh = true;
    acc.severe = 'hip';
    acc.lines.push('Hip pain at 5+: deep squatting, sprinting and jumping are out. House rule.');
    return;
  }
  acc.exclusions.highIntensityPlyo = true;
  if (severity === 'moderate') {
    pushUnique(acc.exclusions.excludedPatterns, 'sprint');
    acc.lines.push('Moderate hip pain: no high-intensity jumps and no sprints, hip work capped at 80 percent, hip mobility every week. House rule.');
  } else {
    acc.lines.push('Mild hip pain: no high-intensity jumps, hip work capped at 80 percent, hip mobility every week. House rule.');
  }
  capPatterns(acc, ['squat', 'hinge', 'lunge'], pct, 'hip pain, house rule');
}

/**
 * House `house.pain_finger`: the rule book has no finger template, so this one
 * is labelled as a house rule the same way hamstring, hip and other are. It
 * works on the pulling patterns, which is where finger load lives.
 */
export function applyFinger(acc: Accumulator, severity: PainSeverity, ruleset: Ruleset, pct: number): void {
  houseTemplate(acc, ruleset, 'house.pain_finger');
  if (severity === 'severe') {
    pushUnique(acc.exclusions.excludedPatterns, 'pull_vertical');
    pushUnique(acc.exclusions.excludedPatterns, 'pull_horizontal');
    acc.severe = 'finger';
    acc.lines.push('Finger pain at 5+: pulling and hanging work is out. House rule.');
    return;
  }
  if (severity === 'moderate') {
    pushUnique(acc.exclusions.excludedPatterns, 'pull_vertical');
    acc.lines.push('Moderate finger pain: no hanging or vertical pulling, remaining pulls capped at 80 percent. House rule.');
  } else {
    acc.lines.push('Mild finger pain: pulling work capped at 80 percent and open hand only. House rule.');
  }
  capPatterns(acc, ['pull_vertical', 'pull_horizontal'], pct, 'finger pain, house rule');
}

export function applyOther(acc: Accumulator, severity: PainSeverity, ruleset: Ruleset, pct: number): void {
  houseTemplate(acc, ruleset, 'house.pain_other');
  if (severity === 'severe') {
    acc.exclusions.highIntensityPlyo = true;
    acc.exclusions.allPlyo = true;
    acc.severe = 'other';
    acc.lines.push('Pain at another site at 5+: maximal work is removed everywhere. House rule.');
    return;
  }
  acc.volumeCuts.intensityTierDown = true;
  capAttribute(acc, 'all', pct, 'pain at another site, house rule');
  acc.lines.push('Pain at another site: everything drops one intensity tier and loaded work is capped at 80 percent until you reassess. House rule.');
}

