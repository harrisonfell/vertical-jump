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
import { Button, ButtonRow, Notice, Screen, Sheet, Skeleton, Text, space } from '@/ui';
import { SETUP_COPY, formatDayDate } from './copy';
import {
  GenerationBlockedError,
  buildFailureLines,
  buildProgramPlan,
  type BuildPlan,
} from './buildProgram';
import { writeProgramPlan } from './writeProgram';
import { StepFrame } from './parts';
import { baselineReading, useBaselineTest } from './useBaseline';
import { feasibilityLine } from './stepTwoValidation';
import { mmToInches } from './stepTwoValidation';

/**
 * Build: run the rule book over the answers, write week 1, and show the
 * validation report only if a rule refused. Nothing is written until the
 * engine returns, so a refusal leaves the database exactly as it was.
 */

interface Failure {
  readonly blocked: boolean;
  readonly lines: readonly string[];
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

  const build = useMutation<BuildPlan, Error, void>({
    mutationFn: async () => {
      if (db === null) throw new Error('The database is not open yet.');
      const row = athlete.data;
      if (row == null) throw new Error('Your answers have not saved yet.');
      const built = buildProgramPlan({
        athlete: row,
        pains: pains.data ?? [],
        baseline: baselineReading(baseline.data),
        today,
        generatedAt: nowIso(),
      });
      await writeProgramPlan(db, built);
      return built;
    },
    onSuccess: (built) => {
      setFailure(null);
      setPlan(built);
      void client.invalidateQueries({ queryKey: queryKeys.currentProgram() });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error) => {
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

          <Button
            label={build.isError ? SETUP_COPY.buildRetry : SETUP_COPY.buildAction}
            onPress={() => build.mutate()}
            fullWidth
            loading={build.isPending}
            testID="build-run"
          />

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
