import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { kgToLb, lbToKg, mmToIn } from '@vert/engine/units';
import type { Instrument } from '@/data';
import { Button, ButtonRow, Chip, ChipRow, Hairline, Stepper, Text, space, type ChipOption } from '@/ui';
import {
  AttemptRow,
  blankAttempt,
  isRsiMode,
  readDraft,
  summaryLine,
  type Attempt as DraftAttempt,
  type TestDraft,
} from '@/features/test';
import type { Attempt } from './attempts';

/**
 * The attempt grid inside the runner.
 *
 * This is the same grid as the Log jump test sheet, not a second one that
 * drifts: the row, the placeholder, the flag chip and every rule about what
 * counts come from `@/features/test`, so a change to the sheet is a change
 * here. Today keeps only what the runner adds around it, which is the
 * instrument chips, the bodyweight reading and the save button.
 *
 * The athlete reads the OVR Jump display and types one number, or two in RSI
 * mode. Steppers are 44 px and move at 0.1 in because that is the device's own
 * resolution; the keypad is decimal for the same reason. A flag marks an
 * attempt that landed outside the field, which keeps it in the record and out
 * of the best.
 */

export const MIN_ATTEMPTS = 3;
export const MAX_ATTEMPTS = 5;

export interface TestFormValue {
  readonly attempts: readonly Attempt[];
  readonly instrument: Instrument;
  readonly bodyweightKg: number | null;
  readonly canonical: boolean;
}

export interface TestFormProps {
  readonly instrument: Instrument;
  readonly onInstrumentChange: (instrument: Instrument) => void;
  readonly bodyweightKg: number | null;
  readonly onBodyweightChange: (kg: number) => void;
  /** The last session's best on this stream, for the soft warning. */
  readonly lastBestMm: number | null;
  readonly onSubmit: (value: TestFormValue) => void;
  readonly saving?: boolean;
  /** Names the cause and the fix; the typed attempts are never cleared. */
  readonly saveError?: string | null;
  readonly testID?: string;
}

const INSTRUMENTS: readonly ChipOption<Instrument>[] = [
  { value: 'ovr_jump_regular', label: 'OVR Jump' },
  { value: 'ovr_jump_rsi', label: 'OVR Jump RSI' },
  { value: 'vertec_reach_touch', label: 'Vertec' },
];

/**
 * The rows that reach the store: the ones with a number in them, renumbered so
 * the attempt indices close up behind an untouched row. A row nobody typed
 * into is not an attempt, so it is not written as one.
 */
function submitted(attempts: readonly DraftAttempt[]): Attempt[] {
  return attempts
    .filter((attempt): attempt is DraftAttempt & { heightIn: number } => attempt.heightIn !== null)
    .map((attempt, position) => ({
      index: position + 1,
      heightIn: attempt.heightIn,
      gctMs: attempt.gctMs,
      flagged: attempt.flagged,
    }));
}

export function TestForm({
  instrument,
  onInstrumentChange,
  bodyweightKg,
  onBodyweightChange,
  lastBestMm,
  onSubmit,
  saving = false,
  saveError = null,
  testID,
}: TestFormProps) {
  const [attempts, setAttempts] = useState<DraftAttempt[]>(() =>
    Array.from({ length: MIN_ATTEMPTS }, () => blankAttempt(instrument)),
  );
  const [canonical, setCanonical] = useState(true);
  const rsiMode = isRsiMode(instrument);

  const draft: TestDraft = useMemo(
    () => ({
      instrument,
      attempts,
      bodyweightLb: bodyweightKg === null ? null : Math.round(kgToLb(bodyweightKg)),
      boxHeightIn: null,
      notes: '',
      canonical,
    }),
    [attempts, bodyweightKg, canonical, instrument],
  );

  const reading = useMemo(
    () => readDraft(draft, lastBestMm === null ? null : mmToIn(lastBestMm)),
    [draft, lastBestMm],
  );

  const errorFor = (index: number): string | undefined =>
    reading.issues.find((issue) => issue.index === index && issue.blocking)?.message;
  const warning = reading.issues.find((issue) => !issue.blocking)?.message;

  const setAttempt = (index: number, next: DraftAttempt): void => {
    setAttempts((current) =>
      current.map((attempt, position) => (position === index ? next : attempt)),
    );
  };

  /** The instrument decides whether a contact time is part of an attempt. */
  const changeInstrument = (next: Instrument): void => {
    onInstrumentChange(next);
    setAttempts((current) =>
      current.map((attempt) => ({
        ...attempt,
        gctMs: isRsiMode(next) ? (attempt.gctMs ?? 200) : null,
      })),
    );
  };

  return (
    <View testID={testID} style={{ gap: space.lg }}>
      <ChipRow
        options={INSTRUMENTS}
        value={instrument}
        onChange={changeInstrument}
        groupLabel="Instrument"
      />

      <View>
        {attempts.map((attempt, index) => (
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
      </View>

      <ButtonRow>
        <Button
          label="Add attempt"
          variant="secondary"
          disabled={attempts.length >= MAX_ATTEMPTS}
          onPress={() =>
            setAttempts((current) => [...current, blankAttempt(instrument)])
          }
        />
        <Button
          label="Remove attempt"
          variant="quiet"
          disabled={attempts.length <= MIN_ATTEMPTS}
          onPress={() => setAttempts((current) => current.slice(0, -1))}
        />
      </ButtonRow>

      <Hairline />

      <Stepper
        label="Bodyweight"
        value={bodyweightKg === null ? 0 : Math.round(kgToLb(bodyweightKg))}
        step={1}
        min={0}
        max={500}
        format={(value) => String(Math.round(value))}
        suffix="lb"
        editable
        onChange={(value) => onBodyweightChange(lbToKg(value))}
      />

      <Chip
        label="Measured under test conditions"
        role="checkbox"
        selected={canonical}
        onPress={() => setCanonical((current) => !current)}
      />

      <Text variant="body" color="ink" numeric accessibilityLiveRegion="polite">
        {summaryLine(reading)}
      </Text>

      {warning === undefined ? null : (
        <Text variant="caption" color="ink2">
          {warning}
        </Text>
      )}
      {saveError === null ? null : (
        <Text
          variant="captionStrong"
          color="danger"
          accessibilityLiveRegion="polite"
          role="alert"
        >
          {saveError}
        </Text>
      )}

      <Button
        label="Save jump test"
        variant="primary"
        size={56}
        fullWidth
        loading={saving}
        disabled={saving || !reading.canSave}
        onPress={() =>
          onSubmit({ attempts: submitted(attempts), instrument, bodyweightKg, canonical })
        }
      />
    </View>
  );
}
