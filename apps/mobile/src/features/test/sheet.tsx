import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { Instrument, JumpTest as EngineJumpTest } from '@vert/engine';
import { kgToLb, mmToIn } from '@vert/engine/units';
import { instrumentLabel } from '@vert/engine/analytics';
import { useAllTests, useAthlete, useToday, useTodayRecovery } from '@/data';
import { readReadinessConfig } from '@/lib/engineAthlete';
import {
  AnswerGroup,
  Button,
  ButtonRow,
  Chip,
  ChipRow,
  Field,
  Notice,
  ResultBlock,
  Sheet,
  Stepper,
  Text,
  space,
} from '@/ui';
import { formatDayLong } from '@/ui/charts';
import { AttemptRow } from './attemptRow';
import { SingleLegPanel, ThrowPanel } from './modePanels';
import {
  BOX_HEIGHTS_IN,
  MAX_ATTEMPTS,
  emptyDraft,
  modeFor,
  throwAttemptCount,
  useClassification,
} from './sheetModel';
import { readSingleLeg } from './singleLeg';
import { readThrow } from './throwTest';
import { useTestSave } from './useTestSave';
import {
  MODE_OPTIONS,
  blankAttempt,
  draftKind,
  isRsiMode,
  kindFor,
  readDraft,
  selectionFor,
  summaryLine,
  throwAttemptsOf,
  type Attempt,
  type TestDraft,
  type TestSelection,
} from './validate';

export interface TestSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The session this test belongs to, when it is logged inside the runner. */
  readonly sessionId?: string | null;
  /** Defaults to the athlete's own today. */
  readonly date?: string;
  readonly instrument?: Instrument;
  /** Replaces this test on save, so an edit recomputes the whole stream. */
  readonly editingId?: string | null;
  readonly initial?: Partial<TestDraft>;
  readonly onSaved?: (result: { readonly bestMm: number | null }) => void;
}

/**
 * The test sheet, shared by Today, the rest day, and Progress.
 *
 * One selector picks what is being logged. Four of its entries are jump
 * instruments and feed the canonical stream; the other two are streams of
 * their own and reach neither the trend, the pace, nor a PR: a single-leg pair
 * (`house.sc.asymmetry_tracking`) and a readiness throw, which is channel B of
 * the gate (`house.sc.readiness_gate`).
 *
 * The athlete reads the number off the device's own display and types it;
 * there is no pairing and no import in this path. Everything the sheet knows
 * about a jump result comes from the engine's analytics, so the line it shows
 * before saving is the line Progress shows afterwards.
 */
export function TestSheet({
  visible,
  onClose,
  sessionId = null,
  date,
  instrument = 'ovr_jump_regular',
  editingId = null,
  initial,
  onSaved,
}: TestSheetProps) {
  const today = useToday();
  const athlete = useAthlete();
  const allTests = useAllTests();
  const recovery = useTodayRecovery();

  const config = readReadinessConfig(athlete.data?.readinessConfig);
  const bodyweightLb =
    athlete.data?.bodyweightKg === null || athlete.data?.bodyweightKg === undefined
      ? null
      : Math.round(kgToLb(athlete.data.bodyweightKg));

  const [draft, setDraft] = useState<TestDraft>(() => ({
    ...emptyDraft({
      instrument,
      kind: 'jump',
      bodyweightLb,
      throwAttempts: throwAttemptCount(config),
    }),
    ...initial,
  }));

  const localDate = date ?? today;
  const kind = draftKind(draft);
  const mode = modeFor(draft.instrument, kind);
  const rsiMode = kind === 'jump' && isRsiMode(draft.instrument);

  const stream = useMemo(() => {
    const rows = allTests.data ?? [];
    return rows
      .filter(
        (test) =>
          test.id !== editingId && test.instrument === draft.instrument && test.mode === mode,
      )
      .map((test): EngineJumpTest => {
        const reps = test.reps
          .filter((rep) => rep.heightMm !== null)
          .map((rep) => ({
            id: rep.id,
            repNumber: rep.attemptIndex,
            heightMm: rep.heightMm ?? 0,
            flagged: rep.flagged,
            entrySource: rep.entrySource,
          }));
        return {
          id: test.id,
          date: test.localDate,
          instrument: test.instrument,
          mode: test.mode,
          unitPreference: 'in',
          isBaseline: test.isBaseline,
          canonical: test.canonical,
          scheduled: test.scheduled,
          reps,
          createdAt: test.createdAt,
          ...(test.connectVersion === null ? null : { ovrConnectVersion: test.connectVersion }),
          ...(test.deviceFirmware === null ? null : { deviceFirmware: test.deviceFirmware }),
        };
      });
  }, [allTests.data, draft.instrument, editingId, mode]);

  const lastBestIn = useMemo(() => {
    for (let index = stream.length - 1; index >= 0; index -= 1) {
      const test = stream[index];
      if (test === undefined) continue;
      const heights = test.reps.filter((rep) => !rep.flagged).map((rep) => rep.heightMm);
      if (heights.length > 0) return mmToIn(Math.max(...heights));
    }
    return null;
  }, [stream]);

  const reading = readDraft(draft, lastBestIn);
  const singleLeg = readSingleLeg(draft);
  const throwReading = readThrow(throwAttemptsOf(draft), config);
  const classification = useClassification(draft, reading.bestIn, stream, mode, localDate);

  const writer = useTestSave({
    localDate,
    mode,
    sessionId,
    editingId,
    config,
    bestIn: reading.bestIn,
    ...(onSaved === undefined ? null : { onSaved }),
    onDone: onClose,
  });

  // Reopening starts a clean draft; a half-typed test from last time on screen
  // would be worse than an empty one.
  useEffect(() => {
    if (!visible) return;
    writer.setError(null);
    setDraft({
      ...emptyDraft({
        instrument,
        kind: 'jump',
        bodyweightLb,
        throwAttempts: throwAttemptCount(config),
      }),
      ...initial,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const setAttempt = useCallback((index: number, attempt: Attempt) => {
    setDraft((current) => ({
      ...current,
      attempts: current.attempts.map((entry, position) => (position === index ? attempt : entry)),
    }));
  }, []);

  const errorFor = (index: number): string | undefined =>
    reading.issues.find((issue) => issue.index === index && issue.blocking)?.message;

  const canSave =
    kind === 'single_leg'
      ? singleLeg.canSave
      : kind === 'readiness_throw'
        ? throwReading.canSave
        : reading.canSave;

  const warnings = kind === 'jump' ? reading.issues.filter((issue) => !issue.blocking) : [];
  const sheetIssue = (
    kind === 'single_leg'
      ? singleLeg.issues
      : kind === 'readiness_throw'
        ? throwReading.issues
        : reading.issues
  ).find((issue) => issue.index === null && issue.blocking);

  /** The selector rewrites the draft, keeping the numbers a mode can carry. */
  const selectMode = (value: TestSelection): void => {
    const nextKind = kindFor(value);
    setDraft((current) => {
      const nextInstrument: Instrument =
        nextKind === 'jump' && value !== 'single_leg' && value !== 'readiness_throw'
          ? value
          : current.instrument;
      if (nextKind !== draftKind(current)) {
        return emptyDraft({
          instrument: nextInstrument,
          kind: nextKind,
          bodyweightLb: current.bodyweightLb,
          throwAttempts: throwAttemptCount(config),
        });
      }
      return {
        ...current,
        instrument: nextInstrument,
        boxHeightIn: isRsiMode(nextInstrument) ? (current.boxHeightIn ?? 18) : null,
        attempts: current.attempts.map((attempt) => ({
          ...attempt,
          gctMs: isRsiMode(nextInstrument) ? (attempt.gctMs ?? 200) : null,
        })),
      };
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editingId === null ? 'Log jump test' : 'Edit jump test'}
      subtitle={formatDayLong(localDate)}
      testID="test-sheet"
      actions={
        <ButtonRow align="between">
          <Button label="Cancel" variant="quiet" onPress={onClose} />
          <Button
            label={editingId === null ? 'Save test' : 'Save changes'}
            variant="primary"
            disabled={!canSave}
            loading={writer.pending}
            onPress={() => {
              void writer.save(draft);
            }}
          />
        </ButtonRow>
      }
    >
      <View style={{ gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <Text variant="label" color="ink2">
            Instrument
          </Text>
          <AnswerGroup
            options={MODE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={selectionFor(kind, draft.instrument)}
            groupLabel="Instrument"
            onChange={selectMode}
          />
        </View>

        {rsiMode ? (
          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink2">
              Box height
            </Text>
            <ChipRow
              options={BOX_HEIGHTS_IN.map((height) => ({ value: height, label: `${height} in` }))}
              value={draft.boxHeightIn}
              groupLabel="Box height"
              onChange={(boxHeightIn) => setDraft((current) => ({ ...current, boxHeightIn }))}
            />
          </View>
        ) : null}

        {kind === 'single_leg' ? (
          <SingleLegPanel draft={draft} onChange={setDraft} />
        ) : kind === 'readiness_throw' ? (
          <ThrowPanel
            attempts={throwAttemptsOf(draft)}
            config={config}
            onChange={(throwValues) =>
              setDraft((current) => ({ ...current, throwAttempts: throwValues }))
            }
          />
        ) : (
          <>
            <View>
              {draft.attempts.map((attempt, index) => (
                <AttemptRow
                  key={index}
                  index={index}
                  attempt={attempt}
                  rsiMode={rsiMode}
                  {...(errorFor(index) === undefined ? null : { error: errorFor(index) })}
                  onChange={(next) => setAttempt(index, next)}
                />
              ))}
              <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
                Flagged attempts are kept and never counted in the best, the trend, or a PR.
              </Text>
              <ButtonRow align="start">
                <Button
                  label="Add attempt"
                  variant="quiet"
                  disabled={draft.attempts.length >= MAX_ATTEMPTS}
                  onPress={() =>
                    setDraft((current) => ({
                      ...current,
                      attempts: [...current.attempts, blankAttempt(current.instrument)],
                    }))
                  }
                />
                <Button
                  label="Remove attempt"
                  variant="quiet"
                  disabled={draft.attempts.length <= 1}
                  onPress={() =>
                    setDraft((current) => ({ ...current, attempts: current.attempts.slice(0, -1) }))
                  }
                />
              </ButtonRow>
            </View>

            <Text variant="body" color="ink" numeric accessibilityLiveRegion="polite">
              {summaryLine(reading)}
            </Text>
          </>
        )}

        {classification === null ? null : (
          /* The block previews the result on paper while the athlete is still
             typing. The committed green surface belongs to a record that is on
             file, so it fires on Today and Progress after the save, never on a
             half-typed number that a backspace can take away. */
          <ResultBlock
            eyebrow={`Jump test · ${formatDayLong(localDate)}`}
            value={classification.value}
            unit="in"
            line={classification.line}
            instrument={`${instrumentLabel(draft.instrument)} · ${mode}`}
            committed={false}
          />
        )}

        {warnings.map((warning) => (
          <Notice key={warning.message} text={warning.message} live />
        ))}
        {sheetIssue === undefined ? null : <Notice text={sheetIssue.message} live />}
        {writer.error === null ? null : (
          <Notice
            text={writer.error}
            actionLabel="Retry"
            live
            onAction={() => {
              void writer.save(draft);
            }}
          />
        )}

        {kind === 'readiness_throw' ? null : (
          <Stepper
            label="Bodyweight"
            value={draft.bodyweightLb ?? 0}
            onChange={(value) => setDraft((current) => ({ ...current, bodyweightLb: value }))}
            step={1}
            min={0}
            max={500}
            format={(value) => `${Math.round(value)}`}
            suffix="lb"
            editable
            helper="Prefilled from your last reading."
          />
        )}

        {kind === 'readiness_throw' ? null : (
          <Field
            label="Notes"
            value={draft.notes}
            onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))}
            placeholder="Shoes, surface, time of day"
            multiline
          />
        )}

        {kind === 'jump' ? (
          <View style={{ gap: space.xs }}>
            <Chip
              label="Canonical test"
              role="checkbox"
              selected={draft.canonical}
              onPress={() => setDraft((current) => ({ ...current, canonical: !current.canonical }))}
            />
            <Text variant="caption" color="ink3">
              Canonical tests feed the trend, the PR, and the chart. Leave it off for a warm-up
              reading.
            </Text>
          </View>
        ) : null}

        {recovery.data?.recoveryScore === null || recovery.data === null ? null : (
          <Text variant="caption" color="ink3" numeric>
            {`Recovery ${recovery.data?.recoveryScore ?? 0}% stored with this test · Data by WHOOP`}
          </Text>
        )}
      </View>
    </Sheet>
  );
}
