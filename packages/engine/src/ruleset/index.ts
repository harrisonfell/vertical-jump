/**
 * Typed loader for the versioned ruleset.
 *
 * The JSON is the single home for every house rule and every constant, so the
 * Plan's rules summary renders from data (brief section 05 "Plan") and no
 * magic number lives in engine code. Validation is total: a malformed file
 * throws at load, never at prescription time.
 */
import rawRuleset from './ruleset.v1.json';
import type {
  HouseRule,
  LayoutRow,
  LayoutSpan,
  LoadScheme,
  Ruleset,
  RulesetConstants,
} from '../types/ruleset.js';
import type { BlockType, LoadType, WeekKind } from '../types/core.js';
import { readClimbing } from './climbing.js';
import {
  RulesetValidationError,
  bool,
  byLevel,
  num,
  numArray,
  obj,
  oneOf,
  range,
  str,
} from './validate.js';

export { RulesetValidationError } from './validate.js';

const LOAD_TYPES: LoadType[] = [
  'heavy_strength',
  'power',
  'ballistic',
  'hypertrophy',
  'endurance',
  'speed_strength',
  'strength_speed',
  'prehab',
  'mobility',
  'bodyweight',
];

const BLOCK_TYPES: BlockType[] = ['strength', 'power'];
const WEEK_KINDS: WeekKind[] = ['load', 'deload', 'taper', 'peak'];
const HOUSE_RULE_KINDS = ['house', 'override', 'reading'] as const;

function readHouseRule(value: unknown, path: string): HouseRule {
  const record = obj(value, path);
  const rules = numArray(record['rules'], `${path}.rules`);
  const magnitude = record['magnitude'];
  const rule: HouseRule = {
    id: str(record['id'], `${path}.id`),
    title: str(record['title'], `${path}.title`),
    text: str(record['text'], `${path}.text`),
    rules,
    kind: oneOf(record['kind'], `${path}.kind`, HOUSE_RULE_KINDS),
  };
  if (magnitude !== undefined) rule.magnitude = str(magnitude, `${path}.magnitude`);
  return rule;
}

function readScheme(value: unknown, path: string): LoadScheme {
  const record = obj(value, path);
  const startRaw = record['startPct'];
  const repsRaw = record['reps'];
  const descentRaw = record['repDescent'];
  const scheme: LoadScheme = {
    startPct: startRaw === null ? null : num(startRaw, `${path}.startPct`),
    stepPct: num(record['stepPct'], `${path}.stepPct`),
    mode: oneOf(record['mode'], `${path}.mode`, ['ascending', 'straight', 'none'] as const),
    reps: repsRaw === null ? null : range(repsRaw, `${path}.reps`),
    repDescent: descentRaw === null ? null : numArray(descentRaw, `${path}.repDescent`),
    respectsLevelCap: bool(record['respectsLevelCap'], `${path}.respectsLevelCap`),
  };
  if (record['repDescentAdvanced'] !== undefined) {
    scheme.repDescentAdvanced = numArray(record['repDescentAdvanced'], `${path}.repDescentAdvanced`);
  }
  if (record['holdSecondsRange'] !== undefined) {
    scheme.holdSecondsRange = range(record['holdSecondsRange'], `${path}.holdSecondsRange`);
  }
  return scheme;
}

function readSpan(value: unknown, path: string): LayoutSpan {
  const record = obj(value, path);
  const weekFrom = num(record['weekFrom'], `${path}.weekFrom`);
  const weekTo = num(record['weekTo'], `${path}.weekTo`);
  if (weekTo < weekFrom) throw new RulesetValidationError(path, 'weekTo is below weekFrom');
  return {
    blockType: oneOf(record['blockType'], `${path}.blockType`, BLOCK_TYPES),
    kind: oneOf(record['kind'], `${path}.kind`, WEEK_KINDS),
    weekFrom,
    weekTo,
  };
}

/** Spans must tile 1..W with no gap and no overlap: the block weeks sum to W. */
function assertSpansTile(spans: LayoutSpan[], W: number, path: string): void {
  let expected = 1;
  for (const [index, span] of spans.entries()) {
    if (span.weekFrom !== expected) {
      throw new RulesetValidationError(`${path}[${index}]`, `expected weekFrom ${expected}`);
    }
    expected = span.weekTo + 1;
  }
  if (expected - 1 !== W) {
    throw new RulesetValidationError(path, `spans cover ${expected - 1} weeks, expected ${W}`);
  }
}

function readLayoutRow(value: unknown, path: string): LayoutRow {
  const record = obj(value, path);
  const W = num(record['W'], `${path}.W`);
  const spansRaw = record['spans'];
  if (!Array.isArray(spansRaw)) throw new RulesetValidationError(`${path}.spans`, 'expected an array');
  const spans = spansRaw.map((span, index) => readSpan(span, `${path}.spans[${index}]`));
  assertSpansTile(spans, W, `${path}.spans`);
  const row: LayoutRow = { W, text: str(record['text'], `${path}.text`), spans };
  if (record['beginnerSpans'] !== undefined) {
    const beginnerRaw = record['beginnerSpans'];
    if (!Array.isArray(beginnerRaw)) {
      throw new RulesetValidationError(`${path}.beginnerSpans`, 'expected an array');
    }
    const beginnerSpans = beginnerRaw.map((span, index) =>
      readSpan(span, `${path}.beginnerSpans[${index}]`),
    );
    assertSpansTile(beginnerSpans, W, `${path}.beginnerSpans`);
    row.beginnerSpans = beginnerSpans;
    row.beginnerText = str(record['beginnerText'], `${path}.beginnerText`);
  }
  return row;
}

function readConstants(value: unknown): RulesetConstants {
  const c = obj(value, 'constants');
  const p = (key: string): string => `constants.${key}`;

  const schemesRaw = obj(c['schemes'], p('schemes'));
  const schemes = {} as Record<LoadType, LoadScheme>;
  for (const loadType of LOAD_TYPES) {
    schemes[loadType] = readScheme(schemesRaw[loadType], `${p('schemes')}.${loadType}`);
  }

  const layoutRaw = c['layout'];
  if (!Array.isArray(layoutRaw)) throw new RulesetValidationError(p('layout'), 'expected an array');
  const layout = layoutRaw.map((row, index) => readLayoutRow(row, `${p('layout')}[${index}]`));

  const contactCaps = obj(c['contactCaps'], p('contactCaps'));
  const schedule = obj(c['highIntensitySchedule'], p('highIntensitySchedule'));
  const strengthLoadWeek = obj(schedule['strengthLoadWeek'], `${p('highIntensitySchedule')}.strengthLoadWeek`);
  const r89 = obj(c['r89'], p('r89'));
  const rest = obj(c['restBoundsS'], p('restBoundsS'));
  const deload = obj(c['deload'], p('deload'));
  const taper = obj(c['taper'], p('taper'));
  const peak = obj(c['peak'], p('peak'));
  const ladder = obj(c['ladderPolicy'], p('ladderPolicy'));
  const drop = obj(c['dropHeight'], p('dropHeight'));
  const adherence = obj(c['adherenceThresholds'], p('adherenceThresholds'));
  const magnitudes = obj(c['outcomeMagnitudes'], p('outcomeMagnitudes'));
  const soreness = obj(c['soreness'], p('soreness'));
  const painCaps = obj(c['painCaps'], p('painCaps'));
  const workingMax = obj(c['workingMax'], p('workingMax'));
  const loadGrid = obj(c['loadGrid'], p('loadGrid'));
  const prThreshold = obj(c['prThreshold'], p('prThreshold'));
  const noise = obj(c['noise'], p('noise'));
  const trend = obj(c['trend'], p('trend'));
  const plateau = obj(c['plateau'], p('plateau'));
  const warmUp = obj(c['warmUp'], p('warmUp'));
  const primer = obj(c['fixedTestPrimer'], p('fixedTestPrimer'));

  return {
    levelTopSetCapPct: byLevel(c['levelTopSetCapPct'], p('levelTopSetCapPct'), num),
    levelTopSetCapDisplayPct: byLevel(
      c['levelTopSetCapDisplayPct'],
      p('levelTopSetCapDisplayPct'),
      num,
    ),
    rpeCap: byLevel(c['rpeCap'], p('rpeCap'), num),
    rpeLadder: numArray(c['rpeLadder'], p('rpeLadder')),
    week1RpeLadder: numArray(c['week1RpeLadder'], p('week1RpeLadder')),
    week1RpeCap: num(c['week1RpeCap'], p('week1RpeCap')),
    heavyLiftsPerSession: byLevel(c['heavyLiftsPerSession'], p('heavyLiftsPerSession'), num),
    stabilityCeiling: byLevel(c['stabilityCeiling'], p('stabilityCeiling'), (v, path) =>
      oneOf(v, path, ['low', 'moderate', 'high'] as const),
    ),
    extensiveRange: byLevel(c['extensiveRange'], p('extensiveRange'), range),
    loadedJumpCeilingPct: byLevel(c['loadedJumpCeilingPct'], p('loadedJumpCeilingPct'), num),
    depthJumpEligible: byLevel(c['depthJumpEligible'], p('depthJumpEligible'), bool),
    contactCaps: {
      highIntensityPerSession: num(contactCaps['highIntensityPerSession'], 'contactCaps.highIntensityPerSession'),
      highAmplitudePerSession: num(contactCaps['highAmplitudePerSession'], 'contactCaps.highAmplitudePerSession'),
      depthJumpContactsPerRep: num(contactCaps['depthJumpContactsPerRep'], 'contactCaps.depthJumpContactsPerRep'),
      depthJumpRepCap: num(contactCaps['depthJumpRepCap'], 'contactCaps.depthJumpRepCap'),
      testAttemptContacts: num(contactCaps['testAttemptContacts'], 'contactCaps.testAttemptContacts'),
      primerJumpCapStrengthDay: num(contactCaps['primerJumpCapStrengthDay'], 'contactCaps.primerJumpCapStrengthDay'),
      upperMobilityRange: range(contactCaps['upperMobilityRange'], 'contactCaps.upperMobilityRange'),
      recovery: num(contactCaps['recovery'], 'contactCaps.recovery'),
    },
    highIntensitySchedule: {
      strengthLoadWeek: {
        testContacts: num(strengthLoadWeek['testContacts'], 'strengthLoadWeek.testContacts'),
        maxFromIntensiveJumps: num(strengthLoadWeek['maxFromIntensiveJumps'], 'strengthLoadWeek.maxFromIntensiveJumps'),
      },
      powerLoadWeekDepthJumpReps: numArray(
        schedule['powerLoadWeekDepthJumpReps'],
        'highIntensitySchedule.powerLoadWeekDepthJumpReps',
      ),
      deloadHalvesAndRemovesDepthJumps: bool(
        schedule['deloadHalvesAndRemovesDepthJumps'],
        'highIntensitySchedule.deloadHalvesAndRemovesDepthJumps',
      ),
      taperMaxWithinFourDays: num(schedule['taperMaxWithinFourDays'], 'highIntensitySchedule.taperMaxWithinFourDays'),
    },
    r89: {
      extensiveStepPerWeek: num(r89['extensiveStepPerWeek'], 'r89.extensiveStepPerWeek'),
      highIntensityFactor: num(r89['highIntensityFactor'], 'r89.highIntensityFactor'),
    },
    schemes,
    rampSetPct: numArray(c['rampSetPct'], p('rampSetPct')),
    restBoundsS: {
      sets2to3: range(rest['sets2to3'], 'restBoundsS.sets2to3'),
      sets4to5: range(rest['sets4to5'], 'restBoundsS.sets4to5'),
      sets6to7: range(rest['sets6to7'], 'restBoundsS.sets6to7'),
      sprint: num(rest['sprint'], 'restBoundsS.sprint'),
      maximalJump: num(rest['maximalJump'], 'restBoundsS.maximalJump'),
      extensiveDrill: num(rest['extensiveDrill'], 'restBoundsS.extensiveDrill'),
      accessory: num(rest['accessory'], 'restBoundsS.accessory'),
      prehabMobility: num(rest['prehabMobility'], 'restBoundsS.prehabMobility'),
    },
    deload: {
      volumeFactorMin: num(deload['volumeFactorMin'], 'deload.volumeFactorMin'),
      volumeFactorMax: num(deload['volumeFactorMax'], 'deload.volumeFactorMax'),
      holdLoads: bool(deload['holdLoads'], 'deload.holdLoads'),
    },
    taper: {
      minProgramWeeks: num(taper['minProgramWeeks'], 'taper.minProgramWeeks'),
      volumeFactor: num(taper['volumeFactor'], 'taper.volumeFactor'),
      holdLoads: bool(taper['holdLoads'], 'taper.holdLoads'),
      noDepthJumpsWithinDays: num(taper['noDepthJumpsWithinDays'], 'taper.noDepthJumpsWithinDays'),
    },
    peak: {
      sessionOffsetDays: num(peak['sessionOffsetDays'], 'peak.sessionOffsetDays'),
      mobilityOffsetDays: num(peak['mobilityOffsetDays'], 'peak.mobilityOffsetDays'),
      restOffsetDays: num(peak['restOffsetDays'], 'peak.restOffsetDays'),
      testOffsetDays: num(peak['testOffsetDays'], 'peak.testOffsetDays'),
      mainLiftSets: num(peak['mainLiftSets'], 'peak.mainLiftSets'),
      maxHighIntensityContacts: num(peak['maxHighIntensityContacts'], 'peak.maxHighIntensityContacts'),
    },
    blockLengthWeeks: range(c['blockLengthWeeks'], p('blockLengthWeeks')),
    accessoryRotationWeeks: num(c['accessoryRotationWeeks'], p('accessoryRotationWeeks')),
    ladderPolicy: {
      rungsPerWeek: num(ladder['rungsPerWeek'], 'ladderPolicy.rungsPerWeek'),
      rungsPerBlock: num(ladder['rungsPerBlock'], 'ladderPolicy.rungsPerBlock'),
      holdInReducedWeeks: bool(ladder['holdInReducedWeeks'], 'ladderPolicy.holdInReducedWeeks'),
      rank0EquipmentFree: bool(ladder['rank0EquipmentFree'], 'ladderPolicy.rank0EquipmentFree'),
    },
    dropHeight: {
      maxIn: num(drop['maxIn'], 'dropHeight.maxIn'),
      maxInWhenHeavyOrUnknownIn: num(drop['maxInWhenHeavyOrUnknownIn'], 'dropHeight.maxInWhenHeavyOrUnknownIn'),
      heavyBodyweightLb: num(drop['heavyBodyweightLb'], 'dropHeight.heavyBodyweightLb'),
    },
    adherenceThresholds: {
      repeatBelow: num(adherence['repeatBelow'], 'adherenceThresholds.repeatBelow'),
      smallFrom: num(adherence['smallFrom'], 'adherenceThresholds.smallFrom'),
      progressFrom: num(adherence['progressFrom'], 'adherenceThresholds.progressFrom'),
    },
    outcomeMagnitudes: {
      smallExtensiveAdd: num(magnitudes['smallExtensiveAdd'], 'outcomeMagnitudes.smallExtensiveAdd'),
      progressExtensiveAdd: num(magnitudes['progressExtensiveAdd'], 'outcomeMagnitudes.progressExtensiveAdd'),
      progressStartStepPct: num(magnitudes['progressStartStepPct'], 'outcomeMagnitudes.progressStartStepPct'),
      capMinusStartMinimum: num(magnitudes['capMinusStartMinimum'], 'outcomeMagnitudes.capMinusStartMinimum'),
      holdWorkingMaxDropPct: num(magnitudes['holdWorkingMaxDropPct'], 'outcomeMagnitudes.holdWorkingMaxDropPct'),
      secondFailureDropPct: num(magnitudes['secondFailureDropPct'], 'outcomeMagnitudes.secondFailureDropPct'),
      consecutiveHighAdd: num(magnitudes['consecutiveHighAdd'], 'outcomeMagnitudes.consecutiveHighAdd'),
      consecutiveLowVolumeCutPct: num(magnitudes['consecutiveLowVolumeCutPct'], 'outcomeMagnitudes.consecutiveLowVolumeCutPct'),
      kSmall: num(magnitudes['kSmall'], 'outcomeMagnitudes.kSmall'),
      kProgress: num(magnitudes['kProgress'], 'outcomeMagnitudes.kProgress'),
    },
    soreness: {
      threshold: num(soreness['threshold'], 'soreness.threshold'),
      repsAdd: num(soreness['repsAdd'], 'soreness.repsAdd'),
      percentDrop: num(soreness['percentDrop'], 'soreness.percentDrop'),
      highIntensityFactor: num(soreness['highIntensityFactor'], 'soreness.highIntensityFactor'),
      noDepthJumps: bool(soreness['noDepthJumps'], 'soreness.noDepthJumps'),
      deferTest: bool(soreness['deferTest'], 'soreness.deferTest'),
    },
    painCaps: {
      mildIntensityCapPct: num(painCaps['mildIntensityCapPct'], 'painCaps.mildIntensityCapPct'),
      under18CapPct: num(painCaps['under18CapPct'], 'painCaps.under18CapPct'),
      reassessDays: num(painCaps['reassessDays'], 'painCaps.reassessDays'),
      acuteMaxWeeks: num(painCaps['acuteMaxWeeks'], 'painCaps.acuteMaxWeeks'),
      moderateAsMildWeeks: num(painCaps['moderateAsMildWeeks'], 'painCaps.moderateAsMildWeeks'),
      moderateKneeHighIntensityFactor: num(
        painCaps['moderateKneeHighIntensityFactor'],
        'painCaps.moderateKneeHighIntensityFactor',
      ),
      shinModeratePct: num(painCaps['shinModeratePct'], 'painCaps.shinModeratePct'),
      shinMildPct: num(painCaps['shinMildPct'], 'painCaps.shinMildPct'),
    },
    workingMax: {
      epleyConfidence: num(workingMax['epleyConfidence'], 'workingMax.epleyConfidence'),
      maxRaisePctPerWeek: num(workingMax['maxRaisePctPerWeek'], 'workingMax.maxRaisePctPerWeek'),
      week2GuardPct: num(workingMax['week2GuardPct'], 'workingMax.week2GuardPct'),
      epleyLookbackWeeks: num(workingMax['epleyLookbackWeeks'], 'workingMax.epleyLookbackWeeks'),
      epleyMaxReps: num(workingMax['epleyMaxReps'], 'workingMax.epleyMaxReps'),
      rpeQualifyMin: num(workingMax['rpeQualifyMin'], 'workingMax.rpeQualifyMin'),
      rpeQualifyMaxReps: num(workingMax['rpeQualifyMaxReps'], 'workingMax.rpeQualifyMaxReps'),
    },
    loadGrid: {
      barbellStepLb: num(loadGrid['barbellStepLb'], 'loadGrid.barbellStepLb'),
      ballisticRounding: oneOf(loadGrid['ballisticRounding'], 'loadGrid.ballisticRounding', ['down'] as const),
      dumbbellTies: oneOf(loadGrid['dumbbellTies'], 'loadGrid.dumbbellTies', ['down'] as const),
    },
    prThreshold: {
      defaultIn: num(prThreshold['defaultIn'], 'prThreshold.defaultIn'),
      sessionsBeforeRecalibrate: num(prThreshold['sessionsBeforeRecalibrate'], 'prThreshold.sessionsBeforeRecalibrate'),
      sdMultiplier: num(prThreshold['sdMultiplier'], 'prThreshold.sdMultiplier'),
      roundUpToIn: num(prThreshold['roundUpToIn'], 'prThreshold.roundUpToIn'),
    },
    noise: {
      residualSdFloorIn: num(noise['residualSdFloorIn'], 'noise.residualSdFloorIn'),
      testsBeforeUnfloored: num(noise['testsBeforeUnfloored'], 'noise.testsBeforeUnfloored'),
    },
    trend: {
      minTestsForTrend: num(trend['minTestsForTrend'], 'trend.minTestsForTrend'),
      minTestsForStatedTrend: num(trend['minTestsForStatedTrend'], 'trend.minTestsForStatedTrend'),
      minTestsForProjection: num(trend['minTestsForProjection'], 'trend.minTestsForProjection'),
      method: oneOf(trend['method'], 'trend.method', ['theil_sen'] as const),
      brokenGapDays: num(trend['brokenGapDays'], 'trend.brokenGapDays'),
    },
    plateau: {
      tests: num(plateau['tests'], 'plateau.tests'),
      bandIn: num(plateau['bandIn'], 'plateau.bandIn'),
    },
    maxDisplayedExercises: num(c['maxDisplayedExercises'], p('maxDisplayedExercises')),
    maxHighCnsPerSession: num(c['maxHighCnsPerSession'], p('maxHighCnsPerSession')),
    maxJointHighStressPerSession: num(c['maxJointHighStressPerSession'], p('maxJointHighStressPerSession')),
    jointHighStressWeekThreshold: num(c['jointHighStressWeekThreshold'], p('jointHighStressWeekThreshold')),
    jointHighStressWeekReductionPct: num(c['jointHighStressWeekReductionPct'], p('jointHighStressWeekReductionPct')),
    warmUp: {
      movementsMin: num(warmUp['movementsMin'], 'warmUp.movementsMin'),
      movementsMax: num(warmUp['movementsMax'], 'warmUp.movementsMax'),
      minutesMin: num(warmUp['minutesMin'], 'warmUp.minutesMin'),
      minutesMax: num(warmUp['minutesMax'], 'warmUp.minutesMax'),
    },
    fixedTestPrimer: {
      pogoSets: num(primer['pogoSets'], 'fixedTestPrimer.pogoSets'),
      pogoReps: num(primer['pogoReps'], 'fixedTestPrimer.pogoReps'),
      submaxCmjSets: num(primer['submaxCmjSets'], 'fixedTestPrimer.submaxCmjSets'),
      submaxCmjReps: num(primer['submaxCmjReps'], 'fixedTestPrimer.submaxCmjReps'),
      extensiveContacts: num(primer['extensiveContacts'], 'fixedTestPrimer.extensiveContacts'),
    },
    maximalSessionSpacingDays: num(c['maximalSessionSpacingDays'], p('maximalSessionSpacingDays')),
    r111RaisePct: num(c['r111RaisePct'], p('r111RaisePct')),
    chainProgramWeeks: num(c['chainProgramWeeks'], p('chainProgramWeeks')),
    maxLayoutWeeks: num(c['maxLayoutWeeks'], p('maxLayoutWeeks')),
    minProgramWeeks: num(c['minProgramWeeks'], p('minProgramWeeks')),
    climbing: readClimbing(c['climbing'], p('climbing')),
    layout,
  };
}

/** Validate an arbitrary value as a ruleset. Throws `RulesetValidationError`. */
export function validateRuleset(value: unknown): Ruleset {
  const record = obj(value, 'root');
  const houseRulesRaw = record['houseRules'];
  if (!Array.isArray(houseRulesRaw)) {
    throw new RulesetValidationError('houseRules', 'expected an array');
  }
  const houseRules = houseRulesRaw.map((rule, index) => readHouseRule(rule, `houseRules[${index}]`));
  const ids = new Set<string>();
  for (const rule of houseRules) {
    if (ids.has(rule.id)) throw new RulesetValidationError('houseRules', `duplicate id ${rule.id}`);
    ids.add(rule.id);
  }
  const constants = readConstants(record['constants']);
  const covered = new Set(constants.layout.map((row) => row.W));
  for (let W = constants.minProgramWeeks; W <= constants.maxLayoutWeeks; W += 1) {
    if (!covered.has(W)) throw new RulesetValidationError('constants.layout', `missing W = ${W}`);
  }
  return { version: str(record['version'], 'version'), houseRules, constants };
}

/** The single ruleset the engine ships with, validated at module load. */
export const RULESET_V1: Ruleset = validateRuleset(rawRuleset as unknown);

/** The current ruleset. Every generation stores this version in its snapshot. */
export function loadRuleset(): Ruleset {
  return RULESET_V1;
}

/** Look up one house rule by id. Returns undefined when it is not shipped. */
export function findHouseRule(ruleset: Ruleset, id: string): HouseRule | undefined {
  return ruleset.houseRules.find((rule) => rule.id === id);
}
