/**
 * Adversarial lens, part two: the R27 soreness path, the deferred test, and
 * what a chain of outcomes does to the skeleton.
 */
import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../src/calendar.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { applyOutcomeToSkeleton } from '../src/skeleton/advance.js';
import { advancedSkeletonFor } from '../src/materialize/outcome.js';
import { PROGRAM_START, WEEKDAYS, baseAthlete } from './grid.support.js';
import {
  LEVELS,
  checkPrescriptions,
  contextFor,
  freshHistory,
  logsFor,
  note,
  ruleset,
  scriptFor,
  type Findings,
} from './fixed-robustness.support.js';
import type { Athlete } from '../src/types/athlete.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type { OutcomeDecision, SessionRecord, SetLog } from '../src/types/logs.js';
import type { MaterializeContext, WeekPlan } from '../src/types/plan.js';

/* ------------------------------------------------- R27 and the moved test */

describe('lens: the soreness path', () => {
  it('a sore session never exceeds the level extensive range or the halved high-intensity budget', () => {
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
        const range = ruleset.constants.extensiveRange[level];
        const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
        for (const w of [1, 6, 8]) {
          const skeletonWeek = skeleton.weeks.find((week) => week.w === w);
          if (skeletonWeek === undefined) continue;
          for (const session of skeletonWeek.sessions) {
            const label = `d${days}/${level}/w${w}/${session.date}`;
            let calm: WeekPlan;
            try {
              calm = materializeWeek(contextFor(athlete, skeleton, w, { today: session.date }));
            } catch {
              continue;
            }
            let sore: WeekPlan;
            try {
              sore = materializeWeek(
                contextFor(athlete, skeleton, w, {
                  today: session.date,
                  history: { ...freshHistory(), sorenessToday: 8 },
                }),
              );
            } catch (error) {
              note(findings, 'soreness_throw', `${label}: ${String(error)}`);
              continue;
            }
            const before = calm.sessions.find((plan) => plan.date === session.date);
            const after = sore.sessions.find((plan) => plan.date === session.date);
            if (before === undefined || after === undefined) continue;
            if (after.contacts.extensive > range.top) {
              note(
                findings,
                'R27_extensive_over_top',
                `${label}: ${after.contacts.extensive} > ${range.top} (calm ${before.contacts.extensive})`,
              );
            }
            if (after.contacts.extensive > before.contacts.extensive) {
              note(
                findings,
                'R27_extensive_rose',
                `${label}: ${before.contacts.extensive} to ${after.contacts.extensive}`,
              );
            }
            const halved = Math.ceil(before.contacts.highIntensity / 2);
            if (after.contacts.highIntensity > halved) {
              note(
                findings,
                'R27_high_intensity_not_halved',
                `${label}: ${after.contacts.highIntensity} > ${halved} (calm ${before.contacts.highIntensity})`,
              );
            }
          }
        }
      }
    }
    expect(findings).toEqual({});
  });

  it('a deferred test leaves exactly one test day, with the counted contacts it moved', () => {
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
        for (const w of [1, 6, 8]) {
          const skeletonWeek = skeleton.weeks.find((week) => week.w === w);
          const testDay = skeletonWeek?.sessions.find((session) => session.isTestDay);
          if (testDay === undefined) continue;
          const label = `d${days}/${level}/w${w}`;
          let week: WeekPlan;
          try {
            week = materializeWeek(
              contextFor(athlete, skeleton, w, {
                today: testDay.date,
                history: { ...freshHistory(), sorenessToday: 8 },
              }),
            );
          } catch (error) {
            note(findings, 'defer_throw', `${label}: ${String(error)}`);
            continue;
          }
          const flagged = week.sessions.filter((session) => session.isTestDay);
          if (flagged.length !== 1) {
            note(
              findings,
              'defer_two_test_days',
              `${label}: ${flagged.map((session) => `${session.date}/${String(session.testStatus)}`).join(', ')}`,
            );
          }
          for (const session of week.sessions) {
            const hasTestBlock = session.blocks.some((block) => block.name === 'jump_test');
            if (hasTestBlock && session.testStatus === 'deferred') {
              note(findings, 'defer_kept_the_test', `${label} ${session.date}`);
            }
            if (hasTestBlock && session.contacts.highIntensity === 0) {
              note(
                findings,
                'defer_contacts_stale',
                `${label} ${session.date}: test block, 0 high-intensity contacts`,
              );
            }
            if (hasTestBlock && session.dayType === 'recovery_mobility') {
              note(findings, 'defer_onto_recovery', `${label} ${session.date}`);
            }
            if (hasTestBlock && !session.isMaximalCns) {
              note(findings, 'defer_cns_stale', `${label} ${session.date}`);
            }
            const suffix = session.headerSuffixes.some((entry) => entry.includes('Test day'));
            if (suffix && !hasTestBlock) {
              note(
                findings,
                'defer_suffix_stale',
                `${label} ${session.date}: ${session.headerSuffixes.join('|')}`,
              );
            }
          }
        }
      }
    }
    expect(findings).toEqual({});
  });
});

describe('lens: outcome chains', () => {
  it('a repeat, small, progress, hold chain keeps k monotone and the calendar intact', () => {
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
        const label = `d${days}/${level}`;
        let skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
        const history = freshHistory();
        let previous: WeekPlan | undefined;
        let previousLogs: SetLog[] = [];
        let previousRecords: SessionRecord[] = [];
        let previousK = Number.NEGATIVE_INFINITY;

        for (let w = 1; w <= skeleton.W; w += 1) {
          const skeletonWeek = skeleton.weeks.find((entry) => entry.w === w);
          const patch: Partial<MaterializeContext> = {
            history: { ...history },
            today: skeletonWeek?.windowStart ?? PROGRAM_START,
          };
          if (previous !== undefined) {
            patch.prevWeek = { plan: previous, logs: previousLogs, sessions: previousRecords };
          }
          let week: WeekPlan;
          try {
            week = materializeWeek(contextFor(athlete, skeleton, w, patch));
          } catch (error) {
            note(findings, 'chain_throw', `${label} w${w}: ${String(error)}`);
            break;
          }
          const k = week.snapshot.k;
          if (!Number.isFinite(k) || k < 0) note(findings, 'chain_bad_k', `${label} w${w}: ${k}`);
          const repeated = week.repeatOfWeek !== undefined;
          if (!repeated && previousK !== Number.NEGATIVE_INFINITY && k < previousK) {
            note(findings, 'chain_k_fell', `${label} w${w}: ${previousK} to ${k}`);
          }
          previousK = k;
          for (const session of week.sessions) {
            checkPrescriptions(findings, `${label} w${w} ${session.date}`, session, 5);
            const offset = diffDays(week.windowStart, session.date);
            if (offset < 0 || offset > 6) {
              note(
                findings,
                'chain_session_outside_window',
                `${label} w${w} ${session.date} off ${offset}`,
              );
            }
          }
          if (week.w !== w) note(findings, 'chain_week_number', `${label}: asked ${w}, got ${week.w}`);

          const step = scriptFor(w);
          const built = logsFor(week, step);
          previous = week;
          previousLogs = built.logs;
          previousRecords = built.records;
          history.consecutiveAdherence.push(
            week.sessions.length === 0
              ? 0
              : Math.round(week.sessions.length * step.completed) / week.sessions.length,
          );
          // Carry the advanced skeleton forward, as the contract says a caller must.
          skeleton = advancedSkeletonFor(
            contextFor(athlete, skeleton, w + 1, {
              history: { ...history },
              prevWeek: { plan: week, logs: built.logs, sessions: built.records },
            }),
          );
          if (skeleton.weeks.length !== skeleton.W) {
            note(
              findings,
              'chain_week_count',
              `${label} after w${w}: ${skeleton.weeks.length} vs ${skeleton.W}`,
            );
            break;
          }
        }
      }
    }
    expect(findings).toEqual({});
  });

  it('repeat after repeat spends the load weeks, then the taper, then flags the date', () => {
    const findings: Findings = {};
    const athlete = { ...baseAthlete(), targetDate: addDays(PROGRAM_START, 11 * 7) };
    let skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const decision: OutcomeDecision = {
      kind: 'repeat',
      deltaK: 0,
      deltaExtensiveContacts: 0,
      deltaStartPct: 0,
      allowLadderAdvance: false,
      workingMaxDeltaPct: {},
      volumeCutPct: 0,
      line: '',
    };
    const trail: string[] = [];
    let sawTaperDrop = false;
    let sawDateAtRisk = false;
    for (let round = 0; round < 12; round += 1) {
      const advance = applyOutcomeToSkeleton(skeleton, 2, decision, ruleset);
      skeleton = advance.skeleton;
      trail.push(
        `round ${round}: removed ${String(advance.removedLoadWeek)} taper ${advance.droppedTaper} risk ${advance.dateAtRisk}`,
      );
      if (advance.droppedTaper) sawTaperDrop = true;
      if (advance.dateAtRisk) sawDateAtRisk = true;
      if (skeleton.weeks.length !== skeleton.W) {
        note(findings, 'repeat_week_count', `${round}: ${skeleton.weeks.length} vs ${skeleton.W}`);
      }
      const last = skeleton.weeks[skeleton.weeks.length - 1];
      if (last !== undefined && last.kind !== 'peak') {
        note(findings, 'repeat_lost_peak', `${round}: last week is ${last.kind}`);
      }
      for (let index = 0; index + 1 < skeleton.weeks.length; index += 1) {
        const week = skeleton.weeks[index];
        const next = skeleton.weeks[index + 1];
        if (week === undefined || next === undefined) continue;
        if (diffDays(week.windowEnd, next.windowStart) !== 1) {
          note(findings, 'repeat_window_gap', `${round}: w${week.w}`);
        }
      }
    }
    if (!sawTaperDrop) note(findings, 'repeat_never_dropped_taper', trail.join(' / '));
    if (!sawDateAtRisk) note(findings, 'repeat_never_flagged_the_date', trail.join(' / '));
    expect(findings).toEqual({});
  });
});

/* --------------------------------------------------------- repeat details */

describe('lens: repeat absorption details', () => {
  it('repeating the same week twice actually shortens the program twice', () => {
    const findings: Findings = {};
    const athlete = { ...baseAthlete(), targetDate: addDays(PROGRAM_START, 11 * 7) };
    const decision: OutcomeDecision = {
      kind: 'repeat',
      deltaK: 0,
      deltaExtensiveContacts: 0,
      deltaStartPct: 0,
      allowLadderAdvance: false,
      workingMaxDeltaPct: {},
      volumeCutPct: 0,
      line: '',
    };
    for (const at of [2, 6, 9, 10, 11]) {
      let skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
      let previous = '';
      for (let round = 0; round < 3; round += 1) {
        const advance = applyOutcomeToSkeleton(skeleton, at, decision, ruleset);
        skeleton = advance.skeleton;
        const shape = skeleton.weeks
          .map((week) => `${week.kind}${week.repeatOfWeek === undefined ? '' : `R${week.repeatOfWeek}`}`)
          .join(',');
        // Once every load week and the taper are spent there is nothing left
        // to give, and `dateAtRisk` is the honest report of exactly that: a
        // further repeat cannot shorten a program that is already at its floor
        // without sacrificing the peak week that holds the target date.
        if (round > 0 && shape === previous && !advance.dateAtRisk) {
          note(
            findings,
            'repeat_is_a_no_op',
            `w${at} round ${round}: reported removed=${String(advance.removedLoadWeek)} taper=${advance.droppedTaper} risk=${advance.dateAtRisk} but the layout did not change: ${shape}`,
          );
        }
        previous = shape;
        const peak = skeleton.weeks[skeleton.weeks.length - 1];
        const duplicated = peak === undefined ? 0 : peak.notes.length - new Set(peak.notes).size;
        if (duplicated > 0) {
          note(findings, 'repeat_duplicates_a_note', `w${at} round ${round}: ${duplicated} duplicates`);
        }
      }
    }
    expect(findings).toEqual({});
  });

  it('a program that repeats every week eventually gives up the taper and flags the date', () => {
    const findings: Findings = {};
    const athlete = { ...baseAthlete(), targetDate: addDays(PROGRAM_START, 11 * 7) };
    const decision: OutcomeDecision = {
      kind: 'repeat',
      deltaK: 0,
      deltaExtensiveContacts: 0,
      deltaStartPct: 0,
      allowLadderAdvance: false,
      workingMaxDeltaPct: {},
      volumeCutPct: 0,
      line: '',
    };
    let skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    let loadWeeks = skeleton.weeks.filter((week) => week.kind === 'load').length;
    let dropped = false;
    for (let round = 0; round < 20; round += 1) {
      const advance = applyOutcomeToSkeleton(skeleton, 2, decision, ruleset);
      skeleton = advance.skeleton;
      if (advance.droppedTaper || advance.dateAtRisk) dropped = true;
      const now = skeleton.weeks.filter((week) => week.kind === 'load').length;
      // Giving up the taper turns that week into a load week by definition, so
      // the count rises by one on exactly that step. Anywhere else a rise
      // would mean the repeat paid for itself with a week it created.
      if (now > loadWeeks && !advance.droppedTaper) {
        note(findings, 'repeat_added_a_load_week', `round ${round}: ${loadWeeks} to ${now}`);
      }
      loadWeeks = now;
    }
    if (!dropped) {
      note(
        findings,
        'repeat_never_runs_out',
        `20 repeats of week 2 left ${loadWeeks} load weeks, the taper intact and the date unflagged`,
      );
    }
    expect(findings).toEqual({});
  });
});

/* -------------------------------------------------- impossible date inputs */

describe('lens: impossible calendars', () => {
  it('a target too close or in the past is refused, never silently mis-planned', () => {
    const findings: Findings = {};
    const base = baseAthlete();
    const cases: { label: string; today: string; target: string; expectPlan: boolean }[] = [
      { label: 'target 3 days out', today: PROGRAM_START, target: addDays(PROGRAM_START, 3), expectPlan: false },
      { label: 'target today', today: PROGRAM_START, target: PROGRAM_START, expectPlan: false },
      { label: 'target 8 days out', today: PROGRAM_START, target: addDays(PROGRAM_START, 8), expectPlan: true },
      { label: 'target before day 0', today: '2026-09-06', target: '2026-09-06', expectPlan: false },
      { label: 'target in the past', today: PROGRAM_START, target: '2026-01-01', expectPlan: false },
      { label: 'target 6 years out', today: PROGRAM_START, target: '2032-09-06', expectPlan: true },
    ];
    for (const entry of cases) {
      try {
        const skeleton = planSkeleton({ ...base, targetDate: entry.target }, entry.today, ruleset);
        if (!entry.expectPlan) {
          note(findings, 'planned_when_it_should_refuse', `${entry.label}: W=${skeleton.W}`);
        }
      } catch (error) {
        const named = error as Error;
        if (entry.expectPlan) {
          note(findings, 'refused_a_legal_program', `${entry.label}: ${named.name}: ${named.message}`);
        } else if (named.name === 'RangeError') {
          note(
            findings,
            'unnamed_refusal',
            `${entry.label}: a bare RangeError with developer wording, not a named plain-words refusal: ${named.message}`,
          );
        }
      }
    }
    // A mismatched weekday list must be refused by name, not by index luck.
    try {
      planSkeleton({ ...base, weekdays: [1, 2] }, PROGRAM_START, ruleset);
      note(findings, 'weekday_mismatch_accepted', '4 days per week with 2 weekdays chosen');
    } catch (error) {
      if ((error as Error).name !== 'SkeletonInputError') {
        note(findings, 'weekday_mismatch_error', (error as Error).name);
      }
    }
    expect(findings).toEqual({});
  });
});
