/**
 * The public surface the app imports: the root entry and the three subpaths
 * `package.json` declares (`@vert/engine`, `/analytics`, `/units`,
 * `/fixtures`). A missing export here breaks a screen, not a test.
 */
import { describe, expect, it } from 'vitest';
import * as engine from '../src/index.js';
import * as analytics from '../src/analytics/index.js';
import * as units from '../src/units.js';
import * as fixtures from '../src/fixtures/index.js';
import pkg from '../package.json' with { type: 'json' };

describe('the engine public surface', () => {
  it('declares the subpaths the app imports', () => {
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './analytics',
      './units',
      './fixtures',
      './package.json',
    ]);
  });

  it('exports everything the app needs from the root entry', () => {
    const required = [
      'ENGINE_VERSION',
      'materializeWeek',
      'materializeSession',
      'postGenerationLines',
      'assertWeekInvariants',
      'planSkeleton',
      'retargetWeek',
      'absorbRepeat',
      'applyOutcomeToSkeleton',
      'advancedSkeletonFor',
      'getPerSetPrescription',
      'applySorenessReduction',
      'resolveWorkingMax',
      'resolveWorkingMaxes',
      'applyFailureDrop',
      'epley',
      'resolveCapPct',
      'resolveRest',
      'evaluatePainGate',
      'selectSession',
      'eligibleExercises',
      'deriveLevel',
      'deriveSeverity',
      'computeAdherence',
      'decideOutcome',
      'outcomeLine',
      'adherenceLadderLine',
      'canMoveSession',
      'legalMoveTargets',
      'validateWeekdays',
      'loadRuleset',
      'RULESET_V1',
      'findHouseRule',
      'layoutTextFor',
      'loadExercises',
      'indexById',
      'buildOwnerFixture',
      'ownerAthlete',
      'buildClimberFixture',
      'buildDefaultFixture',
      'climberAthlete',
      'scoreReadiness',
      'adjustmentFor',
      'applyReadinessAdjustment',
      'readinessLine',
      'combineBands',
      'rollingMedian',
      'READINESS_HOUSE_RULE_ID',
      'scoreReadinessToday',
      'resolveReadinessConfig',
      'readinessSuffixFor',
      'houseRuleIdsFor',
      'sportRequirementsFor',
      'sportAllows',
      'climbingPlacementFor',
      'planRntSessions',
      'planHardFingerSessions',
      'fingerSpacingOk',
      'placeRnt',
      'isOpenHandOnly',
      'gripAllows',
      'MAXIMAL_CNS_TOP_SET_PCT',
      'mulberry32',
      'computeExtensiveTarget',
      'countContacts',
      'CONTACT_CAPS',
      'parseLocalDate',
      'weekWindows',
      'kgToLb',
      'formatLoadLb',
      'NO_MAX_LINE',
      'workingMaxSourceLine',
      'lastTimeLine',
      'TIMES',
      'MINUS',
      'analytics',
    ];
    for (const name of required) {
      expect(engine, name).toHaveProperty(name);
    }
  });

  it('exports the analytics surface on its own subpath', () => {
    for (const name of [
      'theilSen',
      'paceState',
      'paceReadout',
      'prThreshold',
      'classifyTest',
      'evaluatePr',
      'projection',
      'noiseSd',
      'trendPoints',
      'weeklyReviewLine',
      'recoveryOutputTable',
      'evaluateAutoregulationGate',
      'jumpReadiness',
      'asymmetryPct',
      'weakerSideFrom',
      'readAsymmetry',
      'asymmetryBand',
      'asymmetryTrend',
      'ASYMMETRY_THRESHOLDS',
    ]) {
      expect(analytics, name).toHaveProperty(name);
    }
  });

  it('exports the unit formatters on their own subpath', () => {
    for (const name of [
      'mmToIn',
      'inToMm',
      'kgToLb',
      'lbToKg',
      'roundLoadLb',
      'formatHeightIn',
      'formatLoadedSet',
      'formatBodyweightSet',
      'formatRest',
      'formatHold',
      'formatDistance',
      'formatRepsOnly',
      'formatCuts',
      'formatLastTime',
      'formatVelocity',
      'formatVelocityZone',
      'formatContactMs',
      'formatHeightDeltaIn',
      'TIMES',
      'MINUS',
    ]) {
      expect(units, name).toHaveProperty(name);
    }
  });

  it('exports the fixture on its own subpath', () => {
    expect(fixtures).toHaveProperty('buildOwnerFixture');
    expect(fixtures).toHaveProperty('ownerAthlete');
    expect(fixtures).toHaveProperty('buildWhoopMirror');
    expect(fixtures).toHaveProperty('buildClimberFixture');
    expect(fixtures).toHaveProperty('buildDefaultFixture');
    expect(fixtures).toHaveProperty('climberAthlete');
    expect(fixtures).toHaveProperty('climberReadinessConfig');
    expect(fixtures.FIXTURES_VERSION).toBe('0.1.0');
  });

  it('never leaks a React or React Native import', () => {
    expect(engine).not.toHaveProperty('createElement');
  });
});
