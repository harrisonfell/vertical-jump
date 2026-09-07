import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { formatInteger } from '@vert/engine';
import { href } from '@/app';
import {
  nowIso,
  queryKeys,
  useAthlete,
  useDbOrNull,
  useDbReady,
  usePainStatus,
  useToday,
} from '@/data';
import {
  Button,
  ButtonRow,
  Notice,
  ProgressBar,
  Screen,
  Sheet,
  Skeleton,
  Text,
  space,
} from '@/ui';
import { SETUP_COPY, formatDayDate } from './copy';
import {
  GenerationBlockedError,
  buildFailureLines,
  buildProgramWeeks,
  type BuildPlan,
} from './buildProgram';
import {
  RULE_BOOK_PROGRESS,
  progressFraction,
  progressFromWrite,
  type BuildProgress,
} from './buildProgress';
import { writeProgramPlan } from './writeProgram';
import { StepFrame } from './parts';
import { baselineReading, useBaselineTest } from './useBaseline';
import { feasibilityLine } from './stepTwoValidation';
import { mmToInches } from './stepTwoValidation';

/**
 * Build: run the rule book over the answers a week at a time, write every
 * session of every week, and show the validation report only if a rule
 * refused. Nothing is written until the whole projection returns, so a refusal
 * leaves the database exactly as it was.
 *
 * Materializing and writing share one running `done`, so the bar crosses from
 * the first phase to the second without restarting.
 */

interface Failure {
  readonly blocked: boolean;
  readonly lines: readonly string[];
}

/**
 * One turn of the event loop, so the line on screen is the week the engine has
 * just finished rather than the one it is holding the thread for. Awaited
 * before the first week and again after each one; twelve weeks is a fifth of a
 * second to over half a second on a phone, long enough that one frozen label
 * would be a worse lie than a moving bar.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function BuildScreen() {
  const router = useRouter();
  const today = useToday();
  const client = useQueryClient();
  const db = useDbOrNull();
  const { ready } = useDbReady();
  const athlete = useAthlete();
  const pains = usePainStatus();
  const baseline = useBaselineTest();

  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);

  const build = useMutation<BuildPlan, Error, void>({
    mutationFn: async () => {
      if (db === null) throw new Error('The database is not open yet.');
      const row = athlete.data;
      if (row == null) throw new Error('Your answers have not saved yet.');
      setFailure(null);
      setProgress(RULE_BOOK_PROGRESS);
      await yieldToPaint();
      const built = await buildProgramWeeks(
        {
          athlete: row,
          pains: pains.data ?? [],
          baseline: baselineReading(baseline.data),
          today,
          generatedAt: nowIso(),
        },
        (w, of, total) => {
          setProgress(
            progressFromWrite({ done: w, total, step: { kind: 'materialize', w, of } }),
          );
        },
        yieldToPaint,
      );
      // The writes pick the count up where the materialize phase left it, so
      // one bar covers both halves.
      await writeProgramPlan(
        db,
        built,
        (step) => setProgress(progressFromWrite(step)),
        built.weeks.length,
      );
      // The tab gate reads the current program from the cache the moment the
      // tabs mount, and the cached answer is still "no program" from the boot
      // that sent the athlete here. Invalidating alone is not enough: with no
      // tab mounted there is nothing to refetch, so "Go to Today" would land
      // on the gate, read the stale null, and bounce straight back to this
      // screen. Read the row back and wait for it before the sheet opens.
      await client.refetchQueries({ queryKey: queryKeys.currentProgram() }, { cancelRefetch: true });
      return built;
    },
    onSuccess: (built) => {
      setFailure(null);
      setPlan(built);
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error) => {
      // Nothing was written, so the bar has nothing true to show.
      setProgress(null);
      setFailure({
        blocked: error instanceof GenerationBlockedError,
        lines: buildFailureLines(error),
      });
    },
  });

  if (!ready || athlete.isPending || pains.isPending || baseline.isPending) {
    return (
      <Screen testID="setup-build-loading">
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="line" count={4} />
      </Screen>
    );
  }

  const row = athlete.data;
  const currentIn = baseline.data?.bestHeightMm == null ? null : mmToInches(baseline.data.bestHeightMm);
  const goalIn = row?.goalHeightMm == null ? null : mmToInches(row.goalHeightMm);
  const recap =
    currentIn === null || goalIn === null || row?.targetDate == null
      ? null
      : feasibilityLine({
          currentIn,
          goalIn,
          targetDate: row.targetDate,
          today,
          weekdays: [...(row.weekdays ?? [])].filter(
            (day): day is 0 | 1 | 2 | 3 | 4 | 5 | 6 => day >= 0 && day <= 6,
          ),
        });

  return (
    <Screen testID="setup-build">
      <StepFrame title={SETUP_COPY.buildTitle} lead={SETUP_COPY.buildLead}>
        <View style={{ gap: space.lg }}>
          {row?.daysPerWeek == null ? null : (
            <Text variant="body" color="ink2">
              {`${formatInteger(row.daysPerWeek)} days a week${
                row.targetDate == null ? '' : ` · target ${formatDayDate(row.targetDate)}`
              }`}
            </Text>
          )}
          {recap === null ? null : <Notice text={recap} testID="build-feasibility" />}

          {failure === null ? null : (
            <View style={{ gap: space.sm }} testID="build-validation">
              <Text variant="title" color="ink">
                {failure.blocked ? SETUP_COPY.clearanceTitle : SETUP_COPY.buildValidationTitle}
              </Text>
              <Text variant="body" color="ink2">
                {failure.blocked ? SETUP_COPY.buildBlocked : SETUP_COPY.buildValidationLead}
              </Text>
              {failure.lines.map((line) => (
                <Text key={line} variant="caption" color="ink">
                  {line}
                </Text>
              ))}
            </View>
          )}

          {progress === null ? (
            <Button
              label={build.isError ? SETUP_COPY.buildRetry : SETUP_COPY.buildAction}
              onPress={() => build.mutate()}
              fullWidth
              testID="build-run"
            />
          ) : (
            <ProgressBar
              value={progressFraction(progress)}
              line={progress.line}
              accessibilityLabel={SETUP_COPY.buildRunning}
              testID="build-progress"
            />
          )}

          <ButtonRow align="between">
            <Button
              label={SETUP_COPY.buildBackToAnswers}
              variant="quiet"
              onPress={() => router.replace(href('/setup/two'))}
            />
            {failure?.blocked === true ? (
              <Button
                label={SETUP_COPY.clearanceRecord}
                variant="secondary"
                onPress={() => router.replace(href('/clearance'))}
              />
            ) : null}
          </ButtonRow>
        </View>
      </StepFrame>

      <Sheet
        visible={plan !== null}
        onClose={() => router.replace(href('/'))}
        title={SETUP_COPY.buildSummaryTitle}
        closeLabel="Close"
        testID="build-summary"
        actions={
          <Button
            label={SETUP_COPY.buildGoToToday}
            onPress={() => router.replace(href('/'))}
            fullWidth
            testID="build-go-today"
          />
        }
      >
        <View style={{ gap: space.md }}>
          <Text variant="body" color="ink" testID="build-summary-line">
            {plan?.builtLine ?? ''}
          </Text>
          {(plan?.week1.lines ?? []).map((line) => (
            <Text key={line} variant="caption" color="ink2">
              {line}
            </Text>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
