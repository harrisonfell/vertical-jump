/**
 * Adversarial lens: determinism, edge cases, crashes.
 *
 * Fuzzes planSkeleton and materializeWeek over program lengths 2 to 30, 2 to 5
 * training days, every level, inventories from empty to full, every pain
 * combination, soreness 0 to 10, missing maxes, target dates and today on
 * every weekday, DST-crossing windows, in season, readiness passed or not.
 *
 * Nothing here changes a src file; the shared checks live in
 * fixed-robustness.support.ts.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { PROGRAM_START, WEEKDAYS, baseAthlete } from './grid.support.js';
import {
  LEVELS,
  checkPrescriptions,
  contextFor,
  dstFuzz,
  flagFuzz,
  freshHistory,
  fuzzCases,
  note,
  painFuzz,
  runCase,
  ruleset,
  type Findings,
} from './fixed-robustness.support.js';
import type { Athlete } from '../src/types/athlete.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type { WeekPlan } from '../src/types/plan.js';

describe('lens: crashes and edge cases', () => {
  it('planSkeleton and materializeWeek survive the whole fuzz matrix', () => {
    const findings: Findings = {};
    let cases = 0;
    for (const entry of fuzzCases()) {
      cases += 1;
      runCase(findings, entry, false);
    }
    for (const entry of painFuzz()) {
      cases += 1;
      runCase(findings, entry, true);
    }
    for (const entry of flagFuzz()) {
      cases += 1;
      runCase(findings, entry, true);
    }
    for (const entry of dstFuzz()) {
      cases += 1;
      runCase(findings, entry, true);
    }
    expect(cases).toBeGreaterThan(500);
    expect(findings).toEqual({});
    // Roughly 950 whole programs are generated here, so the sweep needs more
    // than vitest's 5 s default.
  }, 60000);
});

/* ------------------------------------------------------------ determinism */

/** Two independent runs from the same inputs must serialize identically. */
function stableJson(week: WeekPlan): string {
  return JSON.stringify(week, (_key, value: unknown) => {
    if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
    return value;
  });
}

describe('lens: determinism', () => {
  it('the same seed and inputs give byte-identical weeks', () => {
    const findings: Findings = {};
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        for (const seed of [0, 1, 20260907, 4294967295]) {
          const athlete: Athlete = {
            ...baseAthlete(),
            level,
            trainingAge,
            daysPerWeek: days,
            weekdays: WEEKDAYS[days],
            targetDate: addDays(PROGRAM_START, 11 * 7),
          };
          const label = `d${days}/${level}/seed${seed}`;
          const a = planSkeleton(athlete, PROGRAM_START, ruleset);
          const b = planSkeleton({ ...athlete }, PROGRAM_START, ruleset);
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            note(findings, 'skeleton_unstable', label);
          }
          for (const w of [1, 5, 6, 11, 12]) {
            const first = materializeWeek(contextFor(athlete, a, w, { seed }));
            const second = materializeWeek(contextFor({ ...athlete }, b, w, { seed }));
            if (stableJson(first) !== stableJson(second)) {
              note(findings, 'week_unstable', `${label} w${w}`);
            }
          }
          // Re-materializing off the same skeleton object must not drift:
          // a mutated input would show up on the second pass.
          const once = stableJson(materializeWeek(contextFor(athlete, a, 7, { seed })));
          const twice = stableJson(materializeWeek(contextFor(athlete, a, 7, { seed })));
          if (once !== twice) note(findings, 'input_mutated', `${label} w7`);
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            note(findings, 'skeleton_mutated_by_materialize', label);
          }
        }
      }
    }
    expect(findings).toEqual({});
  });

  it('a different seed never breaks an invariant', () => {
    const findings: Findings = {};
    const athlete = { ...baseAthlete(), targetDate: addDays(PROGRAM_START, 11 * 7) };
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    for (let seed = 0; seed < 40; seed += 1) {
      for (const w of [1, 4, 5, 6, 11, 12]) {
        let week: WeekPlan;
        try {
          week = materializeWeek(contextFor(athlete, skeleton, w, { seed }));
        } catch (error) {
          note(findings, 'seed_throw', `seed ${seed} w${w}: ${String(error)}`);
          continue;
        }
        for (const session of week.sessions) {
          checkPrescriptions(findings, `seed${seed} w${w} ${session.date}`, session, 5);
        }
      }
    }
    expect(findings).toEqual({});
  });
});

/* ---------------------------------------------------------------- soreness */

describe('lens: soreness, maxes and today', () => {
  it('soreness 0 to 10 on every session date is safe', () => {
    const findings: Findings = {};
    for (const days of [2, 3, 4, 5] as DaysPerWeek[]) {
      for (const [level, trainingAge] of LEVELS) {
        const athlete: Athlete = {
          ...baseAthlete(),
          level,
          trainingAge,
          daysPerWeek: days,
          weekdays: WEEKDAYS[days],
          targetDate: addDays(PROGRAM_START, 11 * 7),
        };
        const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
        for (const w of [1, 6, 12]) {
          const skeletonWeek = skeleton.weeks.find((week) => week.w === w);
          if (skeletonWeek === undefined) continue;
          for (const session of skeletonWeek.sessions) {
            for (let soreness = 0; soreness <= 10; soreness += 1) {
              const history = { ...freshHistory(), sorenessToday: soreness };
              const label = `d${days}/${level}/w${w}/${session.date}/sore${soreness}`;
              let week: WeekPlan;
              try {
                week = materializeWeek(
                  contextFor(athlete, skeleton, w, { history, today: session.date }),
                );
              } catch (error) {
                note(findings, 'soreness_throw', `${label}: ${String(error)}`);
                continue;
              }
              for (const plan of week.sessions) {
                checkPrescriptions(findings, label, plan, 5);
              }
              const tests = week.sessions.filter((plan) => plan.isTestDay);
              if (tests.length > 1) note(findings, 'two_test_days', `${label}: ${tests.length}`);
            }
          }
        }
      }
    }
    expect(findings).toEqual({});
  });

  it('entered, missing and absurd working maxes all prescribe cleanly', () => {
    const findings: Findings = {};
    const maxes: { label: string; kg: number | null }[] = [
      { label: 'none', kg: null },
      { label: 'tiny', kg: 1 },
      { label: 'normal', kg: 124.7 },
      { label: 'huge', kg: 500 },
    ];
    for (const entry of maxes) {
      for (const [level, trainingAge] of LEVELS) {
        const base = baseAthlete();
        const athlete: Athlete = {
          ...base,
          level,
          trainingAge,
          targetDate: addDays(PROGRAM_START, 11 * 7),
          workingMaxes:
            entry.kg === null
              ? []
              : [
                  {
                    lift: 'back_squat',
                    valueKg: entry.kg,
                    source: 'entered',
                    confidence: 1,
                    frozenAt: `${PROGRAM_START}T03:00:00.000Z`,
                    failStreak: 0,
                  },
                ],
        };
        const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
        for (const w of [1, 2, 6, 11, 12]) {
          let week: WeekPlan;
          try {
            week = materializeWeek(contextFor(athlete, skeleton, w));
          } catch (error) {
            note(findings, 'max_throw', `${entry.label}/${level}/w${w}: ${String(error)}`);
            continue;
          }
          for (const session of week.sessions) {
            checkPrescriptions(findings, `${entry.label}/${level}/w${w}`, session, 5);
          }
        }
      }
    }
    expect(findings).toEqual({});
  });
});

