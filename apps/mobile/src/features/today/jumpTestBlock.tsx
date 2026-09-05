import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { inToMm, kgToLb, formatInteger } from '@vert/engine/units';
import type { Instrument, JumpTestWithReps } from '@/data';
import { useLogJumpTest, useTests, useWhoopStrip } from '@/data';
import { Notice, ResultBlock, Text, space } from '@/ui';
import { attemptsLine, type Attempt } from './attempts';
import { resultView } from './testResult';
import { TestForm, type TestFormValue } from './testForm';

/**
 * The jump test, at the head of the Power block on test day.
 *
 * Before it is logged the block is the attempt grid. After it is logged the
 * block is the result, on paper with its header line in green, because twelve
 * test days in twelve weeks cannot all be the loud moment. The surface commits
 * to green once, for a same-instrument record at or above that stream's
 * threshold, and never during calibration.
 */

const MODE_FOR: Readonly<Record<string, string>> = {
  ovr_jump_regular: 'cmj',
  ovr_jump_rsi: 'rsi',
  vertec_reach_touch: 'reach_touch',
  manual: 'cmj',
};

export interface JumpTestBlockProps {
  readonly today: string;
  readonly sessionId: string | null;
  readonly bodyweightKg: number | null;
  /** "Jump test · Thu 22 Oct". */
  readonly eyebrow: string;
  /** Set when the test was deferred onto this session from an earlier day. */
  readonly movedFrom?: string | null;
  readonly testID?: string;
}

export function JumpTestBlock({
  today,
  sessionId,
  bodyweightKg,
  eyebrow,
  movedFrom = null,
  testID,
}: JumpTestBlockProps) {
  const [instrument, setInstrument] = useState<Instrument>('ovr_jump_regular');
  const [weightKg, setWeightKg] = useState<number | null>(bodyweightKg);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mode = MODE_FOR[instrument] ?? 'cmj';
  const stream = useTests(instrument, mode, false);
  const whoop = useWhoopStrip(today);
  const log = useLogJumpTest();

  const tests = stream.data ?? [];
  const todaysTest = useMemo(
    () => [...tests].reverse().find((test) => test.localDate === today) ?? null,
    [tests, today],
  );
  const baselineMm = useMemo(
    () => tests.find((test) => test.isBaseline)?.bestHeightMm ?? null,
    [tests],
  );
  const lastBestMm = useMemo(() => {
    const earlier = tests.filter((test) => test.localDate < today);
    return earlier[earlier.length - 1]?.bestHeightMm ?? null;
  }, [tests, today]);

  if (todaysTest !== null) {
    return (
      <Result
        test={todaysTest}
        stream={tests}
        eyebrow={eyebrow}
        baselineMm={baselineMm}
        testID={testID}
      />
    );
  }

  const submit = (value: TestFormValue): void => {
    setSaveError(null);
    log.mutate(
      {
        localDate: today,
        instrument: value.instrument,
        mode: MODE_FOR[value.instrument] ?? 'cmj',
        sessionId,
        canonical: value.canonical,
        scheduled: sessionId !== null,
        bodyweightKg: value.bodyweightKg,
        whoopSnapshot: {
          recoveryScore: whoop.data?.recoveryScore ?? null,
          sleepPerformance: whoop.data?.sleepPerformance ?? null,
        },
        attempts: value.attempts.map(toAttemptInput),
      },
      {
        onError: () =>
          setSaveError("Couldn't save the test. Check your connection, then save again."),
      },
    );
  };

  return (
    <View testID={testID} style={{ gap: space.md }}>
      <Text variant="label" color="green">
        {eyebrow}
      </Text>
      {movedFrom === null ? null : (
        <Notice text={`Test moved from ${movedFrom} · after the warm-up, before squats`} />
      )}
      <TestForm
        instrument={instrument}
        onInstrumentChange={setInstrument}
        bodyweightKg={weightKg}
        onBodyweightChange={setWeightKg}
        lastBestMm={lastBestMm}
        onSubmit={submit}
        saving={log.isPending}
        saveError={saveError}
      />
    </View>
  );
}

interface ResultProps {
  readonly test: JumpTestWithReps;
  readonly stream: readonly JumpTestWithReps[];
  readonly eyebrow: string;
  readonly baselineMm: number | null;
  readonly testID?: string;
}

function Result({ test, stream, eyebrow, baselineMm, testID }: ResultProps) {
  const view = resultView(test, stream, eyebrow, baselineMm);

  if (view === null) {
    return (
      <Notice
        testID={testID}
        text="Every attempt is flagged, so there is no result to record."
        detail="Clear a flag on the attempt you want counted."
      />
    );
  }

  const attempts: Attempt[] = test.reps.map((rep) => ({
    index: rep.attemptIndex,
    heightIn: rep.heightMm === null ? null : rep.heightMm / 25.4,
    gctMs: rep.gctMs,
    flagged: rep.flagged,
  }));

  return (
    <View testID={testID} style={{ gap: space.md }}>
      <ResultBlock
        eyebrow={view.eyebrow}
        value={view.value}
        unit="in"
        line={view.classification.line}
        instrument={view.instrument}
        committed={view.committed}
        bleed={16}
        {...(test.bodyweightKg === null
          ? null
          : { footerRight: `Bodyweight ${formatInteger(kgToLb(test.bodyweightKg))} lb` })}
        footerLeft={attemptsLine(attempts)}
      />
    </View>
  );
}

function toAttemptInput(attempt: Attempt): {
  attemptIndex: number;
  heightMm: number | null;
  gctMs: number | null;
  flagged: boolean;
  entrySource: 'typed';
} {
  return {
    attemptIndex: attempt.index,
    heightMm: attempt.heightIn === null ? null : inToMm(attempt.heightIn),
    gctMs: attempt.gctMs,
    flagged: attempt.flagged,
    entrySource: 'typed',
  };
}
