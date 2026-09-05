import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { RULESET_V1 } from '@vert/engine';
import { kgToLb, mmToIn } from '@vert/engine/units';
import { AppHeader, SyncLine, routeHref } from '@/app';
import {
  useAllTests,
  useAthlete,
  useCurrentProgram,
  useDeleteJumpTest,
  useKvValue,
  useLiftSets,
  useLogJumpTest,
  useReadinessTests,
  useSessionsBetween,
  useSetKvValue,
  useSingleLegTests,
  useToday,
  useWeeks,
  useWhoopConnection,
  useWhoopRecovery,
  useWhoopSleep,
  useWhoopWorkoutsBetween,
} from '@/data';
import {
  Button,
  EmptyState,
  Notice,
  ResultBlock,
  Screen,
  Skeleton,
  Text,
  TwoColumn,
  space,
} from '@/ui';
import { TestSheet } from '@/features/test';
import { ProgressCharts } from './charts';
import { Headline } from './headline';
import { BodyweightSection, LedgerSection, RecoveryOutputSection } from './ledger';
import { AsymmetrySection, PullUpSection, ReadinessGateSection } from './climbSections';
import { LiftsSection, ReadinessSection, WeeksSection } from './sections';
import { buildProgressModel } from './select';
import { applyProgressState, describeState, progressStateOverride } from './states';
import type { JumpTestWithReps } from '@/data';
import type { LedgerRow, ProgressSources } from './types';

/** Acknowledgement stamps, so a card stays gone after a cold start. */
export const GOAL_ACK_KEY = 'progress.goalAcknowledgedAt';
export const PROGRAM_ACK_KEY = 'progress.programAcknowledgedAt';

interface Deleted {
  readonly row: LedgerRow;
  /** The whole stored test, so Undo puts back exactly what was there. */
  readonly source: JumpTestWithReps;
}

/**
 * Progress: the evening review.
 *
 * Progressive disclosure, because the first month of a program is otherwise a
 * page of "needs more data". Above the fold sit the week's line, the one big
 * number, the pace sentence and the charts; everything that answers a
 * follow-up question lives behind a headed section that says how much is in
 * it before it is opened.
 */
export function ProgressScreen() {
  const router = useRouter();
  const today = useToday();
  const athlete = useAthlete();
  const program = useCurrentProgram();
  const weeks = useWeeks(program.data?.id);
  const tests = useAllTests();
  const liftSets = useLiftSets();
  const readinessTests = useReadinessTests();
  const singleLegTests = useSingleLegTests();
  const connection = useWhoopConnection();
  const goalAck = useKvValue(GOAL_ACK_KEY);
  const programAck = useKvValue(PROGRAM_ACK_KEY);
  const setKv = useSetKvValue();
  const logTest = useLogJumpTest();
  const deleteTest = useDeleteJumpTest();

  const from = program.data?.startDate;
  const to = program.data?.endDate;
  const sessions = useSessionsBetween(from, to);
  const recovery = useWhoopRecovery(from ?? today, today);
  const sleep = useWhoopSleep(from ?? today, today);
  const workouts = useWhoopWorkoutsBetween(
    `${from ?? today}T00:00:00.000Z`,
    `${today}T23:59:59.999Z`,
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);

  const loading =
    program.isPending || tests.isPending || weeks.isPending || athlete.isPending;
  const failed = program.isError || tests.isError || athlete.isError;

  const override = progressStateOverride();

  const model = useMemo(() => {
    const sources: ProgressSources = {
      today,
      athlete: athlete.data ?? null,
      program: program.data ?? null,
      weeks: weeks.data ?? [],
      sessions: sessions.data ?? [],
      tests: tests.data ?? [],
      recovery: recovery.data ?? [],
      sleep: sleep.data ?? [],
      workouts: workouts.data ?? [],
      liftSets: liftSets.data ?? [],
      readinessTests: readinessTests.data ?? [],
      singleLegTests: singleLegTests.data ?? [],
      connection: connection.data ?? null,
      goalAcknowledgedAt: goalAck.data ?? null,
      programAcknowledgedAt: programAck.data ?? null,
      ruleset: RULESET_V1,
    };
    return buildProgressModel(applyProgressState(sources, override));
  }, [
    athlete.data,
    connection.data,
    goalAck.data,
    liftSets.data,
    override,
    programAck.data,
    program.data,
    readinessTests.data,
    recovery.data,
    singleLegTests.data,
    sessions.data,
    sleep.data,
    tests.data,
    today,
    weeks.data,
    workouts.data,
  ]);

  const editedTest =
    editing === null ? undefined : (tests.data ?? []).find((test) => test.id === editing);

  const openSheet = (testId: string | null): void => {
    setEditing(testId);
    setSheetOpen(true);
  };

  const removeTest = (row: LedgerRow): void => {
    const source = (tests.data ?? []).find((test) => test.id === row.id);
    if (source === undefined) return;
    setDeleted({ row, source });
    deleteTest.mutate(row.id);
  };

  // Undo writes the test back on its own stream with everything it carried,
  // which recomputes the PRs a second time and lands where it started.
  const undoDelete = (): void => {
    if (deleted === null) return;
    const { source } = deleted;
    setDeleted(null);
    logTest.mutate({
      localDate: source.localDate,
      performedAt: source.performedAt,
      instrument: source.instrument,
      mode: source.mode,
      unitPreference: source.unitPreference,
      sessionId: source.sessionId,
      boxHeightMm: source.boxHeightMm,
      deviceFirmware: source.deviceFirmware,
      connectVersion: source.connectVersion,
      isBaseline: source.isBaseline,
      canonical: source.canonical,
      scheduled: source.scheduled,
      bodyweightKg: source.bodyweightKg,
      whoopSnapshot: source.whoopSnapshot,
      notes: source.notes,
      attempts: source.reps.map((rep) => ({
        attemptIndex: rep.attemptIndex,
        heightMm: rep.heightMm,
        gctMs: rep.gctMs,
        rsiCalc: rep.rsiCalc,
        rsiDevice: rep.rsiDevice,
        flagged: rep.flagged,
        rejectReason: rep.rejectReason,
        entrySource: rep.entrySource,
      })),
    });
  };

  if (loading && (tests.data ?? []).length === 0) {
    return <ProgressSkeleton />;
  }

  if (!model.hasProgram) {
    return (
      <Screen header={<AppHeader title="Progress" variant="headline" />}>
        <EmptyState
          body="No program yet. Progress fills in from your first jump test and your first logged week."
          actionLabel="Build program"
          onAction={() => router.push(routeHref('setupOne'))}
        />
      </Screen>
    );
  }

  const left = (
    <View style={{ gap: space.lg }}>
      <Headline
        model={model.headline}
        paceLine={model.paceLine}
        noiseNote={model.noiseNote}
        trendCaption={model.trendCaption}
        compact={model.compactHeadline}
      />
      <Button
        label="Log jump test"
        variant="primary"
        size={56}
        fullWidth
        onPress={() => openSheet(null)}
      />
      {model.chart === null ? null : (
        <ProgressCharts
          jump={model.chart}
          weeks={model.loadWeeks}
          days={model.recoveryDays}
          ownerMedian={model.recoveryMedian}
          caption={model.recoveryCaption}
        />
      )}
    </View>
  );

  const right = (
    <View style={{ gap: space.md }}>
      <WeeksSection rows={model.weekRows} earlier={model.earlierRows} />
      <PullUpSection model={model.pullUp} />
      <AsymmetrySection model={model.asymmetry} />
      <ReadinessGateSection model={model.readinessGate} />
      <LiftsSection lifts={model.lifts} />
      <ReadinessSection rows={model.readiness} reps={model.readinessReps} />
      <RecoveryOutputSection table={model.recoveryOutput} bands={model.recoveryDots} />
      <LedgerSection
        rows={model.ledger}
        deletedId={deleted?.row.id ?? null}
        deletedLabel={deleted?.row.dateLabel ?? null}
        onEdit={(row) => openSheet(row.id)}
        onDelete={removeTest}
        onUndo={undoDelete}
      />
      <BodyweightSection rows={model.bodyweight} />
    </View>
  );

  return (
    <Screen wide header={<AppHeader title="Progress" variant="headline" />} testID="progress">
      <SyncLine />

      {failed ? (
        <Notice
          text="Showing the saved copy on this phone. Some numbers may be behind."
          actionLabel="Retry"
          onAction={() => {
            void tests.refetch();
            void program.refetch();
          }}
        />
      ) : null}

      {model.card === null ? null : (
        <View style={{ gap: space.sm }}>
          {/* While a card is up it owns the one display number on the screen,
              and the Headline below drops to title size. A card with no number
              of its own (a program finished before any test) stands on its
              eyebrow and its line rather than borrowing an unrelated height. */}
          {model.card.value === null ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label" color="green">
                {model.card.eyebrow}
              </Text>
              <Text variant="body" color="ink" numeric style={{ maxWidth: 560 }}>
                {model.card.line}
              </Text>
              <Text variant="label" color="ink2">
                {model.card.instrument}
              </Text>
            </View>
          ) : (
            <ResultBlock
              eyebrow={model.card.eyebrow}
              value={model.card.value}
              unit="in"
              line={model.card.line}
              instrument={model.card.instrument}
              committed={model.card.kind === 'goal_reached'}
              bleed={space.lg}
            />
          )}
          <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
            <Button
              label={model.card.primaryLabel}
              variant="primary"
              onPress={() => {
                const key = model.card?.kind === 'goal_reached' ? GOAL_ACK_KEY : PROGRAM_ACK_KEY;
                setKv.mutate({ key, value: today });
              }}
            />
            {model.card.secondaryLabel === null ? null : (
              <Button
                label={model.card.secondaryLabel}
                variant="secondary"
                onPress={() => router.push(routeHref('settings'))}
              />
            )}
          </View>
        </View>
      )}

      {model.targetPassed ? (
        <Notice
          text={model.paceLine}
          actionLabel="Set a new target date"
          onAction={() => router.push(routeHref('settings'))}
        />
      ) : null}

      <Text variant="body" color="ink" numeric style={{ maxWidth: 640 }} testID="progress-review">
        {model.reviewLine}
      </Text>

      {override === 'default' ? null : (
        <Text variant="caption" color="ink3" testID="progress-dev-state">
          {describeState(override, athlete.data?.goalHeightMm ?? null)}
        </Text>
      )}

      {model.streamNotes.map((note) => (
        <Text key={note} variant="caption" color="ink2" style={{ maxWidth: 560 }}>
          {note}
        </Text>
      ))}

      <TwoColumn left={left} right={right} />

      <TestSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        instrument={editedTest?.instrument ?? model.instrument}
        editingId={editing}
        {...(editedTest === undefined ? null : { initial: initialFor(editedTest) })}
      />
    </Screen>
  );
}

/** Prefill the sheet from a stored test, so Edit opens what is on file. */
function initialFor(row: JumpTestWithReps): {
  readonly attempts: { heightIn: number | null; gctMs: number | null; flagged: boolean }[];
  readonly notes: string;
  readonly canonical: boolean;
  readonly bodyweightLb: number | null;
} {
  return {
    attempts: row.reps.map((rep) => ({
      heightIn: rep.heightMm === null ? null : mmToIn(rep.heightMm),
      gctMs: rep.gctMs,
      flagged: rep.flagged,
    })),
    notes: row.notes ?? '',
    canonical: row.canonical,
    bodyweightLb: row.bodyweightKg === null ? null : Math.round(kgToLb(row.bodyweightKg)),
  };
}

/** The skeleton mirrors the final layout: header, number, panels, sections. */
export function ProgressSkeleton() {
  return (
    <Screen wide header={<AppHeader title="Progress" variant="headline" />} testID="progress-skeleton">
      <Skeleton skeletonFor="line" />
      <Skeleton skeletonFor="header" />
      <Skeleton skeletonFor="chartPanel" count={3} />
      <Skeleton skeletonFor="line" count={6} />
    </Screen>
  );
}
