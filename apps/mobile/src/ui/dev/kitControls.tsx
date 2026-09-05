import { formatHeightValueIn, formatInteger, inToMm } from '@vert/engine/units';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, ButtonRow } from '../primitives/button';
import { AnswerGroup } from '../primitives/answerRow';
import { ChipRow, type ChipOption } from '../primitives/chip';
import { Field } from '../primitives/field';
import { Header } from '../primitives/header';
import { Stepper } from '../primitives/stepper';
import { space } from '../theme';
import { KitCase, KitSection } from './kitSection';

const SORENESS: readonly ChipOption<number>[] = Array.from({ length: 11 }, (_, value) => ({
  value,
  label: String(value),
}));

const TRAINING_AGE = [
  { value: 'none', label: 'None' },
  { value: 'under1', label: 'Less than 1 year' },
  { value: '1to3', label: '1-3 years' },
  { value: '4plus', label: '4+ years' },
] as const;

type TrainingAgeAnswer = (typeof TRAINING_AGE)[number]['value'];

const noop = (): void => undefined;

/** Header, buttons, chips, answer rows, fields, steppers. */
export function KitControls() {
  const [soreness, setSoreness] = useState<number | null>(3);
  const [age, setAge] = useState<TrainingAgeAnswer>('1to3');
  const [bodyweight, setBodyweight] = useState('181');
  const [goal, setGoal] = useState('');
  const [attempt, setAttempt] = useState(32.5);
  const [load, setLoad] = useState(205);

  return (
    <View style={{ gap: space.lg }}>
      <KitSection title="Header" note="Slim, sticky, one hairline. Label by default.">
        <KitCase label="label variant with a date on the right">
          <Header
            title="Week 7 of 12 · Power block · Full Body Strength"
            trailingText="Mon 20 Oct"
          />
        </KitCase>
        <KitCase label="headline variant with a settings control">
          <Header
            title="Progress"
            variant="headline"
            subtitle="OVR Jump · standing CMJ"
            right={<Button label="Settings" variant="quiet" glyph="settings" onPress={noop} />}
          />
        </KitCase>
      </KitSection>

      <KitSection title="Button" note="Four variants, two heights, no radius and no red.">
        <KitCase label="primary, secondary, quiet, destructive at 44">
          <ButtonRow>
            <Button label="Log jump test" variant="primary" onPress={noop} />
            <Button label="Change match" variant="secondary" onPress={noop} />
            <Button label="Edit in Settings" variant="quiet" onPress={noop} />
            <Button label="Delete all data" variant="destructive" onPress={noop} />
          </ButtonRow>
        </KitCase>
        <KitCase label="disabled and loading">
          <ButtonRow>
            <Button label="Build program" variant="primary" disabled onPress={noop} />
            <Button label="Sync now" variant="secondary" loading onPress={noop} />
            <Button label="Retry" variant="quiet" disabled onPress={noop} />
          </ButtonRow>
        </KitCase>
        <KitCase label="56 high, full width, with a glyph">
          <Button
            label="Finish session"
            variant="primary"
            size={56}
            fullWidth
            glyph="check"
            onPress={noop}
          />
        </KitCase>
      </KitSection>

      <KitSection title="Chip and ChipRow" note="Soreness 0 to 5 and 6 to 10, on two lines.">
        <KitCase label="soreness today">
          <ChipRow
            options={SORENESS}
            value={soreness}
            onChange={setSoreness}
            splitAfter={6}
            groupLabel="Soreness today"
          />
        </KitCase>
        <KitCase label="disabled group">
          <ChipRow
            options={SORENESS.slice(0, 6)}
            value={null}
            onChange={setSoreness}
            groupLabel="Soreness today"
            disabled
          />
        </KitCase>
      </KitSection>

      <KitSection title="AnswerRow" note="Setup radios: plain rows, no glyph on the left.">
        <AnswerGroup
          options={TRAINING_AGE}
          value={age}
          onChange={(value) => setAge(value)}
          groupLabel="Training age"
        />
      </KitSection>

      <KitSection title="Field" note="Label above, helper or error below in a live region.">
        <KitCase label="numeric with a unit and a helper">
          <Field
            label="Bodyweight"
            value={bodyweight}
            onChangeText={setBodyweight}
            numeric
            suffix="lb"
            helper="Used for the test ledger, never for a target."
          />
        </KitCase>
        <KitCase label="error, with the typed value kept">
          <Field
            label="Goal height"
            value={goal}
            onChangeText={setGoal}
            numeric
            suffix="in"
            error="Goal must be higher than your current 32.5 in."
          />
        </KitCase>
        <KitCase label="disabled">
          <Field
            label="Primary instrument"
            value="OVR Jump"
            onChangeText={noop}
            disabled
            helper="Set when the first canonical test was logged."
          />
        </KitCase>
        <KitCase label="notes, multiline">
          <Field
            label="Notes"
            value=""
            onChangeText={noop}
            multiline
            placeholder="Anything worth remembering next week"
          />
        </KitCase>
      </KitSection>

      <KitSection title="Stepper" note="0.1 in for attempts, 5 lb for a barbell. Engine formatters.">
        <KitCase label="jump attempt, 0.1 in, bounded 6 to 60">
          <Stepper
            label="Attempt 1"
            value={attempt}
            onChange={setAttempt}
            step={0.1}
            min={6}
            max={60}
            format={formatAttemptIn}
            suffix="in"
            helper="Read straight off the OVR Jump display."
          />
        </KitCase>
        <KitCase label="load, 5 lb grid, typed or tapped">
          <Stepper
            label="Load"
            value={load}
            onChange={setLoad}
            step={5}
            min={0}
            format={formatInteger}
            suffix="lb"
            editable
          />
        </KitCase>
        <KitCase label="disabled">
          <Stepper
            label="Attempt 3"
            value={0}
            onChange={noop}
            step={0.1}
            min={0}
            format={formatAttemptIn}
            suffix="in"
            disabled
          />
        </KitCase>
      </KitSection>
    </View>
  );
}

/** The attempt stepper holds inches; the engine formatter takes millimetres. */
function formatAttemptIn(inches: number): string {
  return formatHeightValueIn(inToMm(inches));
}
