import type { JumpTest as EngineJumpTest, JumpRep as EngineJumpRep, Instrument } from '@vert/engine';
import { instrumentLabel, streamKey } from '@vert/engine/analytics';
import type { JumpTestWithReps } from '@/data';

/**
 * The bridge between the store's rows and the engine's analytics.
 *
 * The store keeps a height nullable, because an imported row can arrive
 * without one; the engine's `JumpRep` cannot. A rep with no height is not an
 * attempt, so it is dropped here once and nothing downstream has to ask.
 */
export function toEngineTest(test: JumpTestWithReps): EngineJumpTest {
  const reps: EngineJumpRep[] = [];
  for (const rep of test.reps) {
    if (rep.heightMm === null) continue;
    const converted: EngineJumpRep = {
      id: rep.id,
      repNumber: rep.attemptIndex,
      heightMm: rep.heightMm,
      flagged: rep.flagged,
      entrySource: rep.entrySource,
    };
    if (rep.gctMs !== null) converted.gctMs = rep.gctMs;
    if (rep.rsiCalc !== null) converted.rsiCalc = rep.rsiCalc;
    if (rep.rsiDevice !== null) converted.rsiDevice = rep.rsiDevice;
    if (rep.rejectReason !== null) converted.rejectReason = rep.rejectReason;
    reps.push(converted);
  }

  const bridged: EngineJumpTest = {
    id: test.id,
    date: test.localDate,
    instrument: test.instrument,
    mode: test.mode,
    unitPreference: test.unitPreference === 'cm' ? 'cm' : 'in',
    isBaseline: test.isBaseline,
    canonical: test.canonical,
    scheduled: test.scheduled,
    reps,
    createdAt: test.createdAt,
  };
  if (test.boxHeightMm !== null) bridged.boxHeightIn = test.boxHeightMm / 25.4;
  if (test.deviceFirmware !== null) bridged.deviceFirmware = test.deviceFirmware;
  if (test.connectVersion !== null) bridged.ovrConnectVersion = test.connectVersion;
  if (test.sessionId !== null) bridged.sessionId = test.sessionId;
  if (test.bodyweightKg !== null) bridged.bodyweightKg = test.bodyweightKg;
  if (test.notes !== null) bridged.notes = test.notes;
  return bridged;
}

export { instrumentLabel, streamKey };

/**
 * The stream Progress leads with: the instrument and mode of the newest
 * canonical test. A new device takes over the headline the moment it is used,
 * which is what "the program starts on the OVR stream from session two" means
 * in practice, and the older stream keeps its own line in the ledger.
 */
export function primaryStream(tests: readonly JumpTestWithReps[]): {
  readonly instrument: Instrument;
  readonly mode: string;
} {
  for (let index = tests.length - 1; index >= 0; index -= 1) {
    const test = tests[index];
    if (test !== undefined && test.canonical) {
      return { instrument: test.instrument, mode: test.mode };
    }
  }
  const newest = tests[tests.length - 1];
  if (newest !== undefined) return { instrument: newest.instrument, mode: newest.mode };
  return { instrument: 'ovr_jump_regular', mode: 'Regular' };
}

/** Every test on one stream, oldest first. Streams never share a trend. */
export function onStream(
  tests: readonly JumpTestWithReps[],
  instrument: Instrument,
  mode: string,
): JumpTestWithReps[] {
  return tests.filter((test) => test.instrument === instrument && test.mode === mode);
}

/**
 * The notes a stream break earns on Progress (brief section 06).
 *
 * An instrument change and a device-version change read differently: one is a
 * new measurement stream with its own line, the other is the same instrument
 * with a tick on the chart and a threshold that re-checks after three
 * sessions. Neither ever carries a PR across.
 */
export function streamNotes(
  tests: readonly JumpTestWithReps[],
  instrument: Instrument,
  mode: string,
): string[] {
  const notes: string[] = [];
  const canonical = tests.filter((test) => test.canonical);
  const priorInstruments = new Set<Instrument>();
  for (const test of canonical) {
    if (test.instrument !== instrument) priorInstruments.add(test.instrument);
  }
  if (priorInstruments.size > 0) {
    const earlier = [...priorInstruments].map(instrumentLabel).join(', ');
    notes.push(
      `New instrument stream: ${instrumentLabel(instrument)}. Earlier ${earlier} tests stay on their own line.`,
    );
  }

  const stream = onStream(canonical, instrument, mode).map(toEngineTest);
  const newest = stream[stream.length - 1];
  if (newest !== undefined) {
    let broken: string | null = null;
    for (let index = stream.length - 1; index > 0; index -= 1) {
      const current = stream[index];
      const previous = stream[index - 1];
      if (current === undefined || previous === undefined) continue;
      if (streamKey(current) !== streamKey(previous)) {
        broken = current.ovrConnectVersion ?? current.deviceFirmware ?? null;
        break;
      }
    }
    if (broken !== null) {
      notes.push(`OVR Connect updated to ${broken} · stream break marked`);
    }
  }
  return notes;
}

/** The chart's small labelled ticks: one per device or app version change. */
export function streamBreaks(
  tests: readonly JumpTestWithReps[],
): { readonly date: string; readonly label: string }[] {
  const breaks: { date: string; label: string }[] = [];
  const bridged = tests.map(toEngineTest);
  for (let index = 1; index < bridged.length; index += 1) {
    const current = bridged[index];
    const previous = bridged[index - 1];
    if (current === undefined || previous === undefined) continue;
    if (streamKey(current) === streamKey(previous)) continue;
    const version = current.ovrConnectVersion ?? current.deviceFirmware;
    breaks.push({
      date: current.date,
      label: version === undefined ? instrumentLabel(current.instrument) : `OVR Connect ${version}`,
    });
  }
  return breaks;
}
