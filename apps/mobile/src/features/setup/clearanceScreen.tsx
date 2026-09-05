import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { diffDays, isLocalDate } from '@vert/engine';
import { href } from '@/app';
import {
  athleteStore,
  queryKeys,
  syncStore,
  useAthlete,
  useCurrentProgram,
  useDbOrNull,
  useDbReady,
  usePainStatus,
  useToday,
} from '@/data';
import { Button, Field, Glyph, Notice, Screen, Skeleton, Text, space, useTheme } from '@/ui';
import { SETUP_COPY } from './copy';
import { clearanceScreenFor, nextSetupRoute, reassessDueAt } from './clearanceModel';
import { readClearanceAnswers } from './engineAthlete';
import { StepFrame } from './parts';
import { forcedClearance } from './states';

/**
 * The clearance screen, in both variants.
 *
 * Self-screen failure blocks generation until a clinician clears it (R2).
 * A site at 5+ does not block: it shows the per-location sentence and two
 * choices, and the exclusions apply either way. Paper surface, one glyph, no
 * red: the fact does the work.
 */

type Choice = 'none' | 'date';

export function ClearanceScreen() {
  const router = useRouter();
  const today = useToday();
  const { colors } = useTheme();
  const client = useQueryClient();
  const db = useDbOrNull();
  const { ready } = useDbReady();
  const athlete = useAthlete();
  const pains = usePainStatus();
  const program = useCurrentProgram();

  const [date, setDate] = useState('');
  const [choice, setChoice] = useState<Choice>('none');
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const params = useLocalSearchParams<{ state?: string; location?: string }>();

  const leave = (): void => {
    router.replace(href(nextSetupRoute(athlete.data ?? null, program.data != null)));
  };

  const record = useMutation<void, Error, { readonly clearedOn: string | null }>({
    mutationFn: async ({ clearedOn }) => {
      if (db === null) throw new Error('The database is not open yet.');
      const existing = readClearanceAnswers(athlete.data?.clearance, athlete.data?.isAdult ?? true);
      const next: Record<string, unknown> = { ...existing, nextPromptAt: reassessDueAt(today) };
      if (clearedOn !== null) next['clearedByClinicianAt'] = clearedOn;
      await athleteStore.setClearance(db, next);
      await syncStore.enqueue(db, {
        kind: 'athlete.clearance',
        entityId: athleteStore.ATHLETE_ID,
        payload: next,
      });
      // Either choice re-asks in two weeks: the exclusions ride until then.
      for (const row of pains.data ?? []) {
        if (row.severityDerived !== 'severe') continue;
        await athleteStore.reportPain(db, {
          location: row.location,
          severityRaw: row.severityRaw,
          severityDerived: row.severityDerived,
          onset: row.onset,
          durationWeeks: row.durationWeeks,
          reassessDueAt: reassessDueAt(today),
        });
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: queryKeys.pain() });
      leave();
    },
  });

  if (!ready || athlete.isPending || pains.isPending) {
    return (
      <Screen testID="clearance-loading">
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="line" count={4} />
      </Screen>
    );
  }

  const screen =
    forcedClearance(params.state, params.location) ??
    clearanceScreenFor({
      athlete: athlete.data ?? null,
      pains: pains.data ?? [],
      today,
    });

  if (screen === null) {
    return (
      <Screen testID="clearance-clear">
        <StepFrame title={SETUP_COPY.clearanceTitle} lead="Nothing is in the way right now.">
          <Button label="Continue" onPress={leave} fullWidth />
        </StepFrame>
      </Screen>
    );
  }

  const trimmed = date.trim();
  // An empty field is only an error once Record has been pressed: leaving the
  // field without typing is not a mistake, but pressing Record with nothing in
  // it has to say why nothing happened.
  const dateError =
    trimmed === ''
      ? attempted
        ? SETUP_COPY.clearanceDateRequired
        : undefined
      : !touched
        ? undefined
        : !isLocalDate(trimmed)
          ? SETUP_COPY.clearanceDateInvalid
          : diffDays(today, trimmed) > 0
            ? SETUP_COPY.clearanceDateFuture
            : undefined;

  const submitDate = (): void => {
    setTouched(true);
    setAttempted(true);
    if (trimmed === '' || !isLocalDate(trimmed) || diffDays(today, trimmed) > 0) return;
    record.mutate({ clearedOn: trimmed });
  };

  const severe = screen.kind === 'severe_pain';

  return (
    <Screen testID="clearance">
      <StepFrame title={SETUP_COPY.clearanceTitle}>
        <View style={{ gap: space.lg }}>
          <Glyph name="warning-free" size={24} color={colors.ink2} />
          <Text variant="body" color="ink" testID="clearance-sentence" style={{ maxWidth: 560 }}>
            {screen.sentence}
          </Text>
          {severe ? (
            <Text variant="caption" color="ink3">
              {`${SETUP_COPY.clearanceEitherWay} ${SETUP_COPY.clearanceReprompt}`}
            </Text>
          ) : null}

          {choice === 'date' || !severe ? (
            <View style={{ gap: space.md }}>
              <Field
                label={SETUP_COPY.clearanceDateLabel}
                value={date}
                onChangeText={(text) => {
                  setDate(text);
                  if (text.trim() !== '') setAttempted(false);
                }}
                onBlur={() => setTouched(true)}
                placeholder="YYYY-MM-DD"
                maxLength={10}
                testID="clearance-date"
                {...(dateError === undefined
                  ? { helper: SETUP_COPY.clearanceDateHelper }
                  : { error: dateError })}
              />
              <Button
                label={SETUP_COPY.clearanceRecord}
                onPress={submitDate}
                fullWidth
                loading={record.isPending}
                testID="clearance-record"
              />
            </View>
          ) : (
            <Button
              label={SETUP_COPY.clearanceDateLabel}
              variant="secondary"
              onPress={() => setChoice('date')}
              fullWidth
              testID="clearance-choose-date"
            />
          )}

          {severe ? (
            <Button
              label={SETUP_COPY.clearanceBuildAnyway}
              variant="secondary"
              onPress={() => record.mutate({ clearedOn: null })}
              fullWidth
              loading={record.isPending}
              testID="clearance-build-anyway"
            />
          ) : null}

          {record.isError ? (
            <Notice
              text="Couldn't save that clearance. Check your connection."
              detail="The date you typed is still here."
              live
              testID="clearance-error"
            />
          ) : null}

          <Text variant="caption" color="ink3">
            {SETUP_COPY.clearanceStillReachable}
          </Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={SETUP_COPY.clearanceOpenSettings}
              variant="quiet"
              onPress={() => router.push(href('/settings'))}
            />
          </View>
        </View>
      </StepFrame>
    </Screen>
  );
}
