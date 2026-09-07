import { describe, expect, it } from 'vitest';
import {
  diffParams,
  formatCalendarDate,
  needsRegeneration,
  nextUnstartedWeek,
  regenerationPlan,
  shortCalendarDate,
  trainingAgeLabel,
  versionReason,
  weekdaysLabel,
  type ProgramParams,
} from './regenerate';
import { csvCell, toCsv, testsCsv, whoopCsv } from './exportData';
import { deleteConfirmMatches, DELETE_CONFIRM_WORD } from './deleteAll';
import { workingMaxRows, type LiftSource } from './lifts';
import { wallWindowLabel } from './programDraft';
import {
  BUILD_PROGRAM_LABEL,
  BUILD_PROGRAM_ROUTE,
  NOT_BUILT_VALUE,
  NO_PROFILE_LINE,
  settingsView,
} from './sections';

const base: ProgramParams = {
  trainingAgeYears: 5,
  sport: 'basketball',
  secondaryGoal: null,
  daysPerWeek: 4,
  weekdays: [1, 2, 4, 6],
  gymWindow: 'not set',
  goalHeightMm: 914.4,
  targetDate: '2026-11-29',
  inSeason: false,
  bodyweightKg: 82,
  fingerHistory: false,
  gripMode: 'any',
  fingerPainCeiling: 3,
  weakerSide: null,
  wallWorkDays: [],
  wallWindow: 'not set',
  wallFingerHard: true,
  wallGapHours: 6,
  valgusControl: false,
};

describe('program parameter changes', () => {
  it('sees nothing when nothing moved', () => {
    expect(diffParams(base, { ...base })).toEqual([]);
    expect(needsRegeneration([])).toBe(false);
  });

  it('names each change in the athlete’s own words', () => {
    const changes = diffParams(base, { ...base, daysPerWeek: 3, targetDate: '2026-12-13' });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ field: 'daysPerWeek', label: 'Days a week', from: '4', to: '3' });
    expect(changes[1]?.to).toBe('13 Dec');
  });

  it('shows the training age as the answer, never as a level', () => {
    expect(trainingAgeLabel(2)).toBe('1-3 yrs');
    expect(trainingAgeLabel(5)).toBe('4+ yrs');
    expect(trainingAgeLabel(0)).toBe('None');
    expect(trainingAgeLabel(null)).toBe('not set');
    expect(weekdaysLabel([1, 2, 4, 6])).toBe('Mon Tue Thu Sat');
  });

  it('treats bodyweight as display only', () => {
    const changes = diffParams(base, { ...base, bodyweightKg: 84 });
    expect(changes).toHaveLength(1);
    expect(needsRegeneration(changes)).toBe(false);
  });

  it('regenerates from the first week that has not begun', () => {
    const weeks = [
      { w: 6, windowStart: '2026-10-12', windowEnd: '2026-10-18', loggedSets: 40, startedSessions: 4 },
      { w: 7, windowStart: '2026-10-19', windowEnd: '2026-10-25', loggedSets: 12, startedSessions: 1 },
      { w: 8, windowStart: '2026-10-26', windowEnd: '2026-11-01', loggedSets: 0, startedSessions: 0 },
      { w: 9, windowStart: '2026-11-02', windowEnd: '2026-11-08', loggedSets: 0, startedSessions: 0 },
    ];
    expect(nextUnstartedWeek(weeks, '2026-10-22')).toBe(8);
  });

  it('rebuilds the week the athlete is in when nothing in it is done', () => {
    // The Monday of week 7, before a single set. The answer they just changed
    // has to reach this week, not the one after it.
    const weeks = [
      { w: 7, windowStart: '2026-10-19', windowEnd: '2026-10-25', loggedSets: 0, startedSessions: 0 },
    ];
    expect(nextUnstartedWeek(weeks, '2026-10-19')).toBe(7);
    expect(nextUnstartedWeek(weeks, '2026-10-22')).toBe(7);
  });

  it('never picks a week with a logged set or an opened session in it', () => {
    const logged = [
      { w: 7, windowStart: '2026-10-19', windowEnd: '2026-10-25', loggedSets: 1, startedSessions: 0 },
    ];
    expect(nextUnstartedWeek(logged, '2026-10-22')).toBeNull();
    const opened = [
      { w: 7, windowStart: '2026-10-19', windowEnd: '2026-10-25', loggedSets: 0, startedSessions: 1 },
    ];
    expect(nextUnstartedWeek(opened, '2026-10-22')).toBeNull();
  });

  it('never picks a week whose window has already closed', () => {
    const weeks = [
      { w: 7, windowStart: '2026-10-19', windowEnd: '2026-10-25', loggedSets: 0, startedSessions: 0 },
      { w: 8, windowStart: '2026-10-26', windowEnd: '2026-11-01', loggedSets: 0, startedSessions: 0 },
    ];
    expect(nextUnstartedWeek(weeks, '2026-10-26')).toBe(8);
  });

  it('writes the confirm sheet with the week number in it', () => {
    const changes = diffParams(base, { ...base, daysPerWeek: 3 });
    const plan = regenerationPlan(changes, 8);
    expect(plan.title).toBe('Regenerate from Week 8?');
    expect(plan.confirmLabel).toBe('Regenerate from Week 8');
    expect(plan.lines[0]).toBe('Days a week: 4 to 3');
    expect(plan.lines).toContain('Weeks 1 to 7 keep their logs and are not rebuilt.');
  });

  it('does not claim to keep a week 0 when the whole program is rebuilt', () => {
    const plan = regenerationPlan(diffParams(base, { ...base, daysPerWeek: 3 }), 1);
    expect(plan.title).toBe('Regenerate from Week 1?');
    expect(plan.lines).toContain('Nothing is logged yet, so the whole program is rebuilt.');
    expect(plan.lines.some((line) => line.includes('to 0'))).toBe(false);
  });

  it('says so plainly when there is nothing left to rebuild', () => {
    const plan = regenerationPlan(diffParams(base, { ...base, inSeason: true }), null);
    expect(plan.title).toBe('No weeks left to rebuild');
    expect(plan.confirmLabel).toBe('Save changes');
  });

  it('writes a version reason for the history line', () => {
    expect(versionReason(diffParams(base, { ...base, targetDate: '2026-12-13' }))).toBe(
      'target date changed',
    );
    expect(versionReason(diffParams(base, { ...base, targetDate: '2026-12-13', inSeason: true }))).toBe(
      '2 settings changed',
    );
    expect(versionReason([])).toBe('no change');
  });
});

describe('export files', () => {
  it('quotes only the fields that need it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(false)).toBe('false');
  });

  it('writes RFC 4180 line endings', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('a,b\r\n1,2\r\n');
  });

  it('writes one row per attempt with the engine’s own inches', () => {
    const csv = testsCsv([
      {
        id: 't1', athleteId: 'a', sessionId: null, localDate: '2026-10-22',
        performedAt: '2026-10-22T18:00:00.000Z', instrument: 'ovr_jump_regular', mode: 'cmj',
        unitPreference: 'in', boxHeightMm: null, deviceFirmware: null, connectVersion: null,
        isBaseline: false, canonical: true, scheduled: true, bodyweightKg: 82,
        whoopSnapshot: null, notes: null, importBatchId: null,
        createdAt: '', updatedAt: '',
        reps: [
          {
            id: 'r1', jumpTestSessionId: 't1', attemptIndex: 1, heightMm: 825.5, gctMs: null,
            rsiCalc: null, rsiDevice: null, flagged: false, rejectReason: null,
            entrySource: 'typed', importBatchId: null, createdAt: '',
          },
        ],
        bestHeightMm: 825.5, spreadMm: null, isPr: true,
      },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('32.5');
  });

  it('keeps Whoop metric names unabbreviated', () => {
    const csv = whoopCsv([], []);
    expect(csv).toContain('recovery_score');
    expect(csv).toContain('hrv_rmssd_milli');
    expect(csv).toContain('resting_heart_rate');
  });
});

describe('delete all data', () => {
  it('accepts only the typed word', () => {
    expect(DELETE_CONFIRM_WORD).toBe('delete');
    expect(deleteConfirmMatches('delete')).toBe(true);
    expect(deleteConfirmMatches('  Delete ')).toBe(true);
    expect(deleteConfirmMatches('delete everything')).toBe(false);
    expect(deleteConfirmMatches('')).toBe(false);
  });
});

describe('lifts', () => {
  const sources: LiftSource[] = [
    { exerciseId: 'back_squat', name: 'Back squat', valueKg: 124.7, source: 'entered', confidence: 1, estimateKg: 131.5 },
    { exerciseId: 'db_bench', name: 'DB bench press', valueKg: 31.8, source: 'epley', confidence: 0.95, estimateKg: null },
    { exerciseId: 'trap_bar', name: 'Trap-bar deadlift', valueKg: null, source: null, confidence: null, estimateKg: 124.7 },
  ];

  it('shows entered against estimated, and offers the estimate only when there is one', () => {
    const rows = workingMaxRows(sources);
    expect(rows[0]?.valueLine).toBe('275 lb');
    expect(rows[0]?.sourceLine).toBe('entered');
    expect(rows[0]?.canUseEstimate).toBe(true);
    expect(rows[0]?.estimateLine).toBe('estimate 290 lb');
    expect(rows[1]?.sourceLine).toBe('from a logged set (Epley × 0.95)');
    expect(rows[1]?.canUseEstimate).toBe(false);
    expect(rows[2]?.valueLine).toBe('No 1RM yet');
    expect(rows[2]?.canUseEstimate).toBe(true);
  });
});

describe('calendar dates in Settings', () => {
  it('reads a target date as a calendar day, not an ISO string', () => {
    // Defect D-27: the row used to print "2026-10-12".
    expect(formatCalendarDate('2026-10-12')).toBe('Mon 12 Oct 2026');
    expect(formatCalendarDate('2026-11-29')).toBe('Sun 29 Nov 2026');
  });

  it('reads a pain report timestamp as a day, not an ISO stamp', () => {
    // The pain line promised "reported 8 Oct" and printed "reported 2026-10-08".
    expect(shortCalendarDate('2026-10-08T19:04:11.000Z')).toBe('8 Oct');
    expect(shortCalendarDate('2026-11-29')).toBe('29 Nov');
  });
});

describe('the climbing answers in Settings', () => {
  it('names a sport change to speed climbing', () => {
    const changes = diffParams(base, { ...base, sport: 'speed_climbing' });
    expect(changes).toEqual([
      { field: 'sport', label: 'Sport', from: 'Basketball', to: 'Speed climbing' },
    ]);
  });

  it('names every climbing answer that moved, in the athlete’s own words', () => {
    const changes = diffParams(base, {
      ...base,
      secondaryGoal: 'upper_body_power',
      fingerHistory: true,
      gripMode: 'open_hand',
      fingerPainCeiling: 2,
      weakerSide: 'left',
      wallWorkDays: [3, 5],
      wallWindow: '18:00 to 20:00',
      valgusControl: true,
    });
    expect(changes.map((change) => change.label)).toEqual([
      'Second goal',
      'Finger or pulley injury history',
      'Grip',
      'Finger pain ceiling',
      'Weaker side',
      'Wall work days',
      'Wall work window',
      'Valgus control (RNT)',
    ]);
    expect(changes[0]).toEqual({
      field: 'secondaryGoal',
      label: 'Second goal',
      from: 'none',
      to: 'upper body power',
    });
    expect(changes[2]?.to).toBe('open hand only');
    expect(changes[3]?.to).toBe('2 / 10');
    expect(changes[5]?.to).toBe('Wed Fri');
  });

  it('treats every one of them as a rebuild, not as display', () => {
    expect(needsRegeneration(diffParams(base, { ...base, gripMode: 'open_hand' }))).toBe(true);
    expect(needsRegeneration(diffParams(base, { ...base, valgusControl: true }))).toBe(true);
    expect(needsRegeneration(diffParams(base, { ...base, wallWorkDays: [3] }))).toBe(true);
  });

  it('reads a window back the way the rows show it', () => {
    expect(wallWindowLabel('18:00', '20:00')).toBe('18:00 to 20:00');
    expect(wallWindowLabel('', '')).toBe('not set');
    expect(wallWindowLabel('18:00', '')).toBe('not set');
  });
});

describe('what Settings shows', () => {
  // Defect D-49: an athlete who had answered setup but not yet built a program
  // was shown "No profile yet" over the top of the answers already on file.
  it('shows every section, with the program not built yet, when there are answers but no program', () => {
    const view = settingsView({ hasAthlete: true, hasProgram: false });
    expect(view.empty).toBe(false);
    expect(view.program).toBe('not_built');
    expect(view.sections).toEqual([
      'athlete',
      'program',
      'lifts',
      'readiness',
      'link',
      'autoregulation',
      'data',
    ]);
    expect(NOT_BUILT_VALUE).toBe('Not built yet');
    expect(BUILD_PROGRAM_LABEL).toBe('Build program');
    expect(BUILD_PROGRAM_ROUTE).toBe('/setup/two');
  });

  it('keeps the empty state for a device with no athlete row at all', () => {
    const view = settingsView({ hasAthlete: false, hasProgram: false });
    expect(view.empty).toBe(true);
    expect(view.sections).toEqual([]);
    expect(NO_PROFILE_LINE).toBe(
      'No profile yet. Answer the setup questions and your settings appear here.',
    );
  });

  it('shows the program parameters once a program exists', () => {
    const view = settingsView({ hasAthlete: true, hasProgram: true });
    expect(view.empty).toBe(false);
    expect(view.program).toBe('built');
  });

  it('asks to save the answers, not to rebuild weeks, before a program exists', () => {
    const plan = regenerationPlan(diffParams(base, { ...base, daysPerWeek: 3 }), null, false);
    expect(plan.title).toBe('Save your answers?');
    expect(plan.confirmLabel).toBe('Save answers');
    expect(plan.lines).toContain('No program is built yet. Your answers are used when you build one.');
  });
});
