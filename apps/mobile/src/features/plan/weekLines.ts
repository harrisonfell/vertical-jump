import type { ReadinessAdjustment, SessionPlan, WeekPlan } from '@vert/engine';
import { weekdayShort } from './dates';

/**
 * What the week said about individual days.
 *
 * `WeekPlan.lines` carries the sentences that belong to the whole week: the
 * outcome, the tendon line, the rotations, and the knee-alignment row that had
 * to move off a day because it sat too close to wall work
 * (`house.sc.rnt_valgus_control`). The sentences that belong to one day sit on
 * that day's session instead: pulling demoted to light because hard finger
 * work sits 48 hours apart (`house.sc.hard_finger_spacing`), the finger-pain
 * answer that took the hard rows out (`house.sc.finger_pain_ceiling`), and the
 * readiness gate's own line (`house.sc.readiness_gate`).
 *
 * The Plan needs both, so this file lifts the day sentences to the week and
 * names the day in front of each. Nothing is reworded: the engine owns the
 * sentence, this owns which day it belongs to.
 */

/** True when the gate actually reduced something. Downward only, by design. */
export function readinessChangedSomething(adjustment: ReadinessAdjustment): boolean {
  return (
    adjustment.tierDown ||
    adjustment.holdVolume ||
    adjustment.removeMaximalJumps ||
    adjustment.jumpVolumeFactor < 1 ||
    adjustment.loadFactor < 1 ||
    adjustment.extraReps > 0 ||
    adjustment.offerRecoverySwap
  );
}

/**
 * One session's notices as the Plan shows them.
 *
 * `applyReadinessAdjustment` appends the gate's line to `notices` whenever a
 * channel had data, including the days it read both channels as fine. That
 * line belongs on the runner, where "session as written" answers the question
 * the athlete just asked. On the Plan it is noise, so a gate that changed
 * nothing is dropped here and only an adjustment survives.
 */
export function planNoticesFor(session: SessionPlan): string[] {
  const outcome = session.readiness;
  const silent =
    outcome !== undefined && !readinessChangedSomething(outcome.adjustment) ? outcome.line : null;
  return session.notices.filter((notice) => notice !== silent);
}

/** One notice, and the days of the week that carry it. */
interface DayNotice {
  readonly text: string;
  readonly days: string[];
}

/**
 * The week's day sentences, in the order the days fall.
 *
 * A notice that lands on more than one day is said once with both days in
 * front of it, and one that lands on every training day of the week is said
 * once with no day at all: a deload notice is about the week, not about
 * Tuesday. Anything already in `week.lines` is left to `week.lines`.
 *
 * @param plan the built week, as the store read it back.
 * @returns lines like "Tue · Hard finger work needs 48 hours between
 *   sessions, so today's pulling is light."
 */
export function weekDayLines(plan: WeekPlan): string[] {
  const sessions = [...plan.sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (sessions.length === 0) return [];

  const weekLines = new Set(plan.lines);
  const order: string[] = [];
  const byText = new Map<string, DayNotice>();

  for (const session of sessions) {
    for (const notice of planNoticesFor(session)) {
      if (weekLines.has(notice)) continue;
      const found = byText.get(notice);
      if (found === undefined) {
        byText.set(notice, { text: notice, days: [weekdayShort(session.date)] });
        order.push(notice);
      } else if (!found.days.includes(weekdayShort(session.date))) {
        found.days.push(weekdayShort(session.date));
      }
    }
  }

  return order.flatMap((text) => {
    const entry = byText.get(text);
    if (entry === undefined) return [];
    if (entry.days.length >= sessions.length) return [entry.text];
    return [`${entry.days.join(', ')} · ${entry.text}`];
  });
}
