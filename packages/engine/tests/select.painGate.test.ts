import { describe, expect, it } from 'vitest';
import { loadRuleset } from '../src/ruleset/index.js';
import {
  SELF_SCREEN_SENTENCE,
  deriveDuration,
  deriveSeverity,
  effectiveSeverity,
  evaluatePainGate,
  painCapPctFor,
  selfScreenFails,
  severePainSentence,
} from '../src/select/painGate.js';
import type { ClearanceAnswers, PainStatus } from '../src/types/athlete.js';
import type { PainDuration, PainLocation, PainSeverityRaw } from '../src/types/core.js';

const RULESET = loadRuleset();
const TODAY = '2026-10-19';

const CLEAN: ClearanceAnswers = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
};

function status(location: PainLocation, raw: PainSeverityRaw, duration: PainDuration): PainStatus {
  return {
    location,
    severityRaw: raw,
    severity: deriveSeverity(raw),
    duration,
    durationWeeks: duration === 'acute' ? 3 : 30,
    // An acute report old enough that the R6 two-week promotion has expired.
    reportedAt: '2026-09-01',
    reassessDueAt: '2026-09-15',
  };
}

function gate(pain: PainStatus[], isAdult = true, clearance: ClearanceAnswers = CLEAN) {
  return evaluatePainGate({ clearance, painStatus: pain, isAdult, today: TODAY }, RULESET);
}

const LOCATIONS: PainLocation[] = [
  'knee', 'shin', 'back', 'shoulder', 'achilles_calf', 'hamstring', 'hip', 'other',
];
const RAWS: PainSeverityRaw[] = ['1-2', '3-4', '5+'];
const DURATIONS: PainDuration[] = ['acute', 'chronic'];

describe('severity and duration derivation', () => {
  it('maps 1-2 mild, 3-4 moderate, 5+ severe', () => {
    expect(deriveSeverity('1-2')).toBe('mild');
    expect(deriveSeverity('3-4')).toBe('moderate');
    expect(deriveSeverity('5+')).toBe('severe');
  });

  it('calls under 12 weeks acute and 12 or more chronic', () => {
    expect(deriveDuration(11)).toBe('acute');
    expect(deriveDuration(12)).toBe('chronic');
  });

  it('treats mild acute knee pain as moderate for two weeks, then mild again (R6)', () => {
    const fresh: PainStatus = { ...status('knee', '1-2', 'acute'), reportedAt: '2026-10-12', reassessDueAt: '2026-10-26' };
    expect(effectiveSeverity(fresh, '2026-10-19', RULESET)).toBe('moderate');
    expect(effectiveSeverity(fresh, '2026-10-27', RULESET)).toBe('mild');
    const applied = gate([fresh]).applied[0];
    expect(applied?.promotedByR6).toBe(true);
  });
});

describe('the clearance gate', () => {
  it('blocks generation only on the general self-screen (R2)', () => {
    const failing: ClearanceAnswers = { ...CLEAN, chestPain: true };
    expect(selfScreenFails(failing)).toBe(true);
    const blocked = gate([], true, failing);
    expect(blocked.blocksGeneration).toBe(true);
    expect(blocked.clearanceScreen?.kind).toBe('self_screen');
    expect(blocked.clearanceScreen?.sentence).toBe(SELF_SCREEN_SENTENCE);
  });

  it('stops blocking once a clinician clearance date is on file', () => {
    const cleared: ClearanceAnswers = { ...CLEAN, chestPain: true, clearedByClinicianAt: '2026-09-30' };
    expect(gate([], true, cleared).blocksGeneration).toBe(false);
  });

  it('shows the severe-pain screen with the exact sentence and never blocks generation', () => {
    const result = gate([status('knee', '5+', 'chronic')]);
    expect(result.blocksGeneration).toBe(false);
    expect(result.clearanceScreen?.kind).toBe('severe_pain');
    expect(result.clearanceScreen?.sentence).toBe(
      'Medical clearance needed. You reported knee pain at 5+ (limits training). ' +
        'The rule book excludes all knee-stress lifts and all jumps at this level, including the weekly test. ' +
        'Get it assessed.',
    );
    expect(result.restricted).toBe(true);
    expect(result.reassessDueDays).toBe(RULESET.constants.painCaps.reassessDays);
  });

  it('flags a restricted plan when the owner builds anyway', () => {
    const result = evaluatePainGate(
      { clearance: CLEAN, painStatus: [status('back', '5+', 'chronic')], isAdult: true, today: TODAY, buildAnyway: true },
      RULESET,
    );
    expect(result.buildAnyway).toBe(true);
    expect(result.exclusions.axialAll).toBe(true);
  });

  it('names every location in the severe sentence', () => {
    for (const location of LOCATIONS) {
      const sentence = severePainSentence(location);
      expect(sentence.startsWith('Medical clearance needed. You reported ')).toBe(true);
      expect(sentence.endsWith('Get it assessed.')).toBe(true);
      expect(sentence).toContain('at 5+ (limits training).');
    }
  });
});

describe('the location table: every location by severity and duration', () => {
  for (const location of LOCATIONS) {
    for (const raw of RAWS) {
      for (const duration of DURATIONS) {
        it(`${location} ${raw} ${duration}`, () => {
          const result = gate([status(location, raw, duration)]);
          expect(result.blocksGeneration).toBe(false);
          expect(result.restricted).toBe(true);
          expect(result.lines.length).toBeGreaterThan(0);
          if (raw === '5+') {
            expect(result.clearanceScreen?.kind).toBe('severe_pain');
            expect(result.clearanceScreen?.location).toBe(location);
          } else {
            expect(result.clearanceScreen).toBeNull();
          }
        });
      }
    }
  }

  it('applies R20 to R22 at any severity', () => {
    for (const raw of RAWS) {
      expect(gate([status('knee', raw, 'chronic')]).exclusions.kneeHigh).toBe(true);
      expect(gate([status('back', raw, 'chronic')]).exclusions.spineHigh).toBe(true);
      expect(gate([status('shoulder', raw, 'chronic')]).exclusions.shoulderHigh).toBe(true);
    }
  });

  it('halves high-intensity contacts on moderate knee pain (R4) and adds knee prehab', () => {
    const result = gate([status('knee', '3-4', 'chronic')]);
    expect(result.volumeCuts.highIntensityFactor).toBe(RULESET.constants.painCaps.moderateKneeHighIntensityFactor);
    expect(result.tendonProtocols).toContain('knee');
    expect(result.requiredWeekly).toContain('knee_prehab');
  });

  it('caps mild knee pain at 80 percent on knee-stress work only (R5, R163)', () => {
    const result = gate([status('knee', '1-2', 'chronic')]);
    expect(result.caps.intensityPct).toBe(80);
    expect(result.caps.scopedTo).toEqual(['knee_stress']);
    expect(painCapPctFor(result, {
      kneeStress: 'moderate', spineStress: 'low', shoulderStress: 'low',
      isAxialLoad: false, isPressing: false, isOverhead: false, movementPattern: 'squat',
    })).toBe(80);
    expect(painCapPctFor(result, {
      kneeStress: 'low', spineStress: 'low', shoulderStress: 'low',
      isAxialLoad: false, isPressing: true, isOverhead: false, movementPattern: 'push_horizontal',
    })).toBeUndefined();
  });

  it('cuts pogo and sprint volume on shin splints (R8, R9)', () => {
    expect(gate([status('shin', '3-4', 'chronic')]).volumeCuts.pogoSprintPct)
      .toBe(RULESET.constants.painCaps.shinModeratePct);
    expect(gate([status('shin', '1-2', 'chronic')]).volumeCuts.pogoSprintPct)
      .toBe(RULESET.constants.painCaps.shinMildPct);
    expect(gate([status('shin', '3-4', 'chronic')]).exclusions.highImpactPlyo).toBe(true);
    expect(gate([status('shin', '5+', 'chronic')]).exclusions.repetitiveImpact).toBe(true);
  });

  it('follows the Achilles ladder R16 to R18', () => {
    expect(gate([status('achilles_calf', '5+', 'chronic')]).exclusions.allPlyo).toBe(true);
    expect(gate([status('achilles_calf', '3-4', 'chronic')]).exclusions.highIntensityPlyo).toBe(true);
    expect(gate([status('achilles_calf', '1-2', 'chronic')]).volumeCuts.intensityTierDown).toBe(true);
    expect(gate([status('achilles_calf', '1-2', 'chronic')]).tendonProtocols).toContain('achilles');
  });

  it('removes overhead pressing on moderate shoulder pain and caps pressing when mild', () => {
    expect(gate([status('shoulder', '3-4', 'chronic')]).exclusions.overhead).toBe(true);
    expect(gate([status('shoulder', '3-4', 'chronic')]).exclusions.pressing).toBe(false);
    expect(gate([status('shoulder', '5+', 'chronic')]).exclusions.pressing).toBe(true);
    const mild = gate([status('shoulder', '1-2', 'chronic')]);
    expect(mild.caps.scopedTo).toEqual(['pressing']);
    expect(mild.requiredWeekly).toContain('scapular_stability');
  });

  it('labels the hamstring, hip and other templates as house rules', () => {
    for (const location of ['hamstring', 'hip', 'other'] as PainLocation[]) {
      const result = gate([status(location, '3-4', 'chronic')]);
      expect(result.houseRule?.kind).toBe('house');
      expect(result.houseRule?.id).toBe(`house.pain_${location}`);
      expect(result.lines.join(' ')).toContain('House rule.');
    }
    const hamstring = gate([status('hamstring', '3-4', 'chronic')]);
    expect(hamstring.requiredWeekly).toContain('hamstring_eccentric');
    expect(hamstring.exclusions.excludedPatterns).toContain('sprint');
    expect(hamstring.patternCaps[0]?.patterns).toEqual(['hinge']);
    const hip = gate([status('hip', '3-4', 'chronic')]);
    expect(hip.requiredWeekly).toContain('hip_mobility');
    expect(hip.exclusions.highIntensityPlyo).toBe(true);
  });
});

describe('the age cap', () => {
  it('caps everything at 90 percent under 18 (R1)', () => {
    const result = gate([], false);
    expect(result.caps.intensityPct).toBe(RULESET.constants.painCaps.under18CapPct);
    expect(result.caps.scopedTo).toEqual(['all']);
    expect(result.blocksGeneration).toBe(false);
  });

  it('keeps the tighter of an 80 percent scoped cap and the 90 percent age cap', () => {
    const result = gate([status('knee', '1-2', 'chronic')], false);
    expect(painCapPctFor(result, {
      kneeStress: 'high', spineStress: 'low', shoulderStress: 'low',
      isAxialLoad: false, isPressing: false, isOverhead: false, movementPattern: 'squat',
    })).toBe(80);
    expect(painCapPctFor(result, {
      kneeStress: 'low', spineStress: 'low', shoulderStress: 'low',
      isAxialLoad: false, isPressing: false, isOverhead: false, movementPattern: 'pull_vertical',
    })).toBe(90);
  });
});

describe('no pain', () => {
  it('leaves nothing restricted', () => {
    const result = gate([]);
    expect(result.restricted).toBe(false);
    expect(result.clearanceScreen).toBeNull();
    expect(result.lines).toEqual([]);
    expect(result.reassessDueDays).toBeUndefined();
  });

  it('ignores a cleared pain record', () => {
    const cleared: PainStatus = { ...status('knee', '5+', 'chronic'), clearedAt: '2026-10-01' };
    expect(gate([cleared]).restricted).toBe(false);
  });
});
