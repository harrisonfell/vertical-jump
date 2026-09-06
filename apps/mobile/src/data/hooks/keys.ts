import type { Instrument, LocalDate, ReadinessTestKind, SessionAnswerKind } from '../types';

/** The query keys from the data contract. One place, so invalidation is exact. */
export const queryKeys = {
  athlete: (): readonly unknown[] => ['athlete'],
  pain: (): readonly unknown[] => ['athlete', 'pain'],
  currentProgram: (): readonly unknown[] => ['program', 'current'],
  week: (programId: string, w: number): readonly unknown[] => ['week', programId, w],
  weeks: (programId: string): readonly unknown[] => ['week', programId],
  session: (sessionId: string): readonly unknown[] => ['session', sessionId],
  sessionsByWeek: (weekId: string): readonly unknown[] => ['session', 'week', weekId],
  sessionsByDate: (date: LocalDate): readonly unknown[] => ['session', 'date', date],
  setLogs: (sessionId: string): readonly unknown[] => ['setLogs', sessionId],
  tests: (instrument: Instrument, mode: string): readonly unknown[] => ['tests', instrument, mode],
  testsAll: (): readonly unknown[] => ['tests'],
  whoopRecovery: (from: LocalDate, to: LocalDate): readonly unknown[] => [
    'whoop',
    'recovery',
    `${from}..${to}`,
  ],
  whoopConnection: (): readonly unknown[] => ['whoop', 'connection'],
  /**
   * The climbing streams (`house.sc.readiness_gate`,
   * `house.sc.asymmetry_tracking`, `house.sc.finger_pain_ceiling`).
   *
   * Everything readiness hangs under one root, so logging a test invalidates
   * the day's gate reading with one call. Single-leg tests sit here rather
   * than under ['tests'] because they are not a jump stream and must never
   * share an invalidation with the trend, the pace, or a PR.
   */
  readiness: (): readonly unknown[] => ['readiness'],
  readinessTests: (kind: ReadinessTestKind): readonly unknown[] => ['readiness', 'tests', kind],
  readinessToday: (date: LocalDate): readonly unknown[] => ['readiness', 'today', date],
  readinessOutcome: (sessionId: string): readonly unknown[] => ['readiness', 'outcome', sessionId],
  singleLegTests: (): readonly unknown[] => ['readiness', 'singleLeg'],
  sessionAnswer: (kind: SessionAnswerKind, date: LocalDate): readonly unknown[] => [
    'readiness',
    'answer',
    kind,
    date,
  ],
  sync: (): readonly unknown[] => ['sync'],
  /** The database copy on the server: this device's standing, and the versions kept. */
  snapshot: (): readonly unknown[] => ['snapshot'],
  autoregulation: (): readonly unknown[] => ['autoregulation'],
  imports: (): readonly unknown[] => ['imports'],
} as const;
