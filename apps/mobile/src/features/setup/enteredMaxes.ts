/**
 * The maxes setup enters, and the baseline reading it stores beside them.
 *
 * Pure: the save path is a mutation, but what it writes is arithmetic, and
 * this is the arithmetic. The box squat and the two older lifts are entered
 * singles; the weighted pull-up field asks for the load worked near a 5RM, so
 * it goes through the engine's own R73 path (`addedLoadFirstFreeze`): Epley
 * with the house confidence factor, snapped to the grid its percentages are
 * shown on. The stored number is the ADDED load; bodyweight is never part of
 * it.
 */
import { addedLoadFirstFreeze, lbToKg, loadRuleset } from '@vert/engine';
import type { Instrument } from '@vert/engine';
import type { WorkingMax } from '@/data';
import { MAX_LIFT_IDS, PULL_UP_ENTRY_REPS } from './liftIds';
import { inchesToMm, parseNumber, reachTouchIn } from './stepTwoValidation';
import type { StepTwoValues } from './stepTwoValues';

export { MAX_LIFT_IDS, PULL_UP_ENTRY_REPS };

function maxEntry(lb: number, at: string): WorkingMax {
  return {
    exerciseId: '',
    valueKg: lbToKg(lb),
    source: 'entered',
    confidence: 1,
    frozenAt: at,
    lastRaiseAt: null,
  };
}

/** The entered maxes, keyed by exercise id. Blank fields write nothing. */
export function workingMaxesFrom(values: StepTwoValues, at: string): Record<string, WorkingMax> {
  const entries: Record<string, WorkingMax> = {};
  const singles = [
    [MAX_LIFT_IDS.squat, values.squatLb],
    [MAX_LIFT_IDS.hinge, values.hingeLb],
    [MAX_LIFT_IDS.press, values.pressLb],
    [MAX_LIFT_IDS.boxSquat, values.boxSquatLb],
  ] as const;
  for (const [id, text] of singles) {
    const lb = parseNumber(text);
    if (lb === null) continue;
    entries[id] = { ...maxEntry(lb, at), exerciseId: id };
  }

  const pullUpLb = parseNumber(values.pullUpAddedLb);
  if (pullUpLb !== null && pullUpLb > 0) {
    const frozen = addedLoadFirstFreeze(
      MAX_LIFT_IDS.pullUp,
      { valueKg: lbToKg(pullUpLb), reps: PULL_UP_ENTRY_REPS, enteredAt: at },
      loadRuleset(),
      at,
    );
    entries[MAX_LIFT_IDS.pullUp] = {
      exerciseId: MAX_LIFT_IDS.pullUp,
      valueKg: frozen.valueKg,
      source: frozen.source,
      confidence: frozen.confidence,
      frozenAt: frozen.frozenAt,
      lastRaiseAt: frozen.lastRaiseAt ?? null,
    };
  }
  return entries;
}

/** The baseline reading, in millimetres, with the stream it belongs to. */
export function baselineFrom(
  values: StepTwoValues,
): { heightMm: number; instrument: Instrument; standingReachMm: number | null } | null {
  if (values.measure === 'device') {
    const inches = parseNumber(values.baselineIn);
    if (inches === null) return null;
    return { heightMm: inchesToMm(inches), instrument: 'ovr_jump_regular', standingReachMm: null };
  }
  const reach = parseNumber(values.reachIn);
  const jump = reachTouchIn(reach, parseNumber(values.touchIn));
  if (jump === null || reach === null) return null;
  return {
    heightMm: inchesToMm(jump),
    instrument: 'vertec_reach_touch',
    standingReachMm: inchesToMm(reach),
  };
}
