import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, ChipRow, Field, Notice, Sheet, Text, space, type ChipOption } from '@/ui';
import { LEGS_FEEL, SESSION_RPE_SCALE } from './finish';
import { SorenessRow } from './sorenessRow';
import type { FinishAnswers, FinishFlow } from './useFinishFlow';

/**
 * The Finish sheet.
 *
 * Four short answers and one control. Everything asked here is something the
 * program acts on: soreness drives tomorrow's tier, session RPE times minutes
 * is the load, legs feel is the honest counterweight to a recovery score.
 * On the week's last workout the sheet ends with the outcome the engine
 * decided, because that is the moment it becomes true.
 */

const RPE_OPTIONS: readonly ChipOption<number>[] = SESSION_RPE_SCALE.map((value) => ({
  value,
  label: String(value),
}));

const LEGS_OPTIONS: readonly ChipOption<'fresh' | 'normal' | 'heavy'>[] = LEGS_FEEL.map((entry) => ({
  value: entry.value,
  label: entry.label,
}));

export interface FinishSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly flow: FinishFlow;
  /** The stored answer, so the row only appears when it was skipped. */
  readonly sorenessPre: number | null;
  /** True while no warm-up row has been logged. */
  readonly warmUpUnchecked: boolean;
  readonly onWarmUpChecked: () => void;
  /** "16 of 18 sets logged". Shown when the session is not complete. */
  readonly partialLine: string | null;
  readonly onFinished: () => void;
}

export function FinishSheet({
  visible,
  onClose,
  flow,
  sorenessPre,
  warmUpUnchecked,
  onWarmUpChecked,
  partialLine,
  onFinished,
}: FinishSheetProps) {
  const [soreness, setSoreness] = useState<number | null>(sorenessPre);
  const [rpe, setRpe] = useState<number | null>(null);
  const [legs, setLegs] = useState<'fresh' | 'normal' | 'heavy' | null>(null);
  const [notes, setNotes] = useState('');
  const [warmUpDone, setWarmUpDone] = useState(!warmUpUnchecked);

  const submit = async (): Promise<void> => {
    const answers: FinishAnswers = {
      sorenessPre: soreness,
      rpe,
      legsFeel: legs,
      notes,
    };
    if (warmUpDone && warmUpUnchecked) onWarmUpChecked();
    await flow.finish(answers);
    onFinished();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Finish session"
      {...(partialLine === null ? null : { subtitle: partialLine })}
      actions={
        flow.outcome === null ? (
          <Button
            label="Finish session"
            variant="primary"
            size={56}
            fullWidth
            loading={flow.saving}
            disabled={flow.saving}
            onPress={() => void submit()}
          />
        ) : (
          <Button label="Close" variant="secondary" size={56} fullWidth onPress={onClose} />
        )
      }
    >
      {flow.outcome === null ? (
        <View style={{ gap: space.xl }}>
          {sorenessPre === null ? (
            <SorenessRow
              value={soreness}
              onAnswer={setSoreness}
              onSkip={() => setSoreness(null)}
              testID="finish-soreness"
            />
          ) : null}

          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink2">
              Session RPE
            </Text>
            <ChipRow
              options={RPE_OPTIONS}
              value={rpe}
              onChange={setRpe}
              groupLabel="Session RPE, 6 to 10"
            />
          </View>

          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink2">
              Legs feel
            </Text>
            <ChipRow
              options={LEGS_OPTIONS}
              value={legs}
              onChange={setLegs}
              groupLabel="How the legs feel"
            />
          </View>

          {warmUpUnchecked ? (
            <Chip
              label="Warm-up done"
              role="checkbox"
              selected={warmUpDone}
              onPress={() => setWarmUpDone((current) => !current)}
            />
          ) : null}

          <Field
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            helper="Anything the numbers do not carry."
          />

          {flow.error === null ? null : <Notice text={flow.error} live />}
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Text variant="label" color="ink2">
            Week decided
          </Text>
          <Text variant="body" color="ink">
            {flow.outcome}
          </Text>
        </View>
      )}
    </Sheet>
  );
}
