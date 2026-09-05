import { View } from 'react-native';
import { AnswerGroup, Chip, Field, Stepper, Text, space } from '@/ui';
import { formatInteger } from '@vert/engine';
import { SETUP_COPY } from './copy';
import { CheckRow, Question } from './parts';
import {
  GRIP_MODE_OPTIONS,
  WEAKER_SIDE_OPTIONS,
  WEEKDAY_CHIPS,
  type GripModeValue,
  type WeakerSideValue,
} from './questions';
import {
  CEILING_MAX,
  CEILING_MIN,
  WALL_GAP_MAX,
  WALL_GAP_MIN,
  validateClimbing,
  type ClimbingAnswers,
  type ClimbingField,
} from './climbing';

/**
 * The five climbing answers, as one block.
 *
 * It appears for a speed climber and for anybody with a finger or pulley
 * history, and it is the same component in setup and in Settings so an answer
 * means the same thing on the day it is changed as it did on the day it was
 * first given.
 */

export interface ClimbingBlockProps {
  readonly values: ClimbingAnswers;
  readonly onChange: (values: ClimbingAnswers) => void;
  /** Fields the athlete has left, so a refusal lands on blur, not per key. */
  readonly touched?: ReadonlySet<ClimbingField>;
  readonly onTouch?: (field: ClimbingField) => void;
  /** Set once the form was submitted: every refusal shows from then on. */
  readonly submitted?: boolean;
}

export function ClimbingBlock({
  values,
  onChange,
  touched,
  onTouch,
  submitted = false,
}: ClimbingBlockProps) {
  const result = validateClimbing(values);
  const errorFor = (field: ClimbingField): string | undefined =>
    submitted || touched?.has(field) === true ? result.errors[field] : undefined;

  const set = <K extends keyof ClimbingAnswers>(key: K, value: ClimbingAnswers[K]): void => {
    onChange({ ...values, [key]: value });
  };

  const toggleDay = (day: number): void => {
    const next = values.wallWorkDays.includes(day)
      ? values.wallWorkDays.filter((entry) => entry !== day)
      : [...values.wallWorkDays, day].sort((a, b) => a - b);
    set('wallWorkDays', next);
  };

  return (
    <View style={{ gap: space.xl }} testID="setup-climbing-block">
      <View style={{ gap: space.xs }}>
        <Text variant="label" color="ink3">
          {SETUP_COPY.stepOneGripTitle}
        </Text>
        <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
          {SETUP_COPY.stepOneGripLead}
        </Text>
      </View>

      <Question label={SETUP_COPY.stepOneGrip} detail={SETUP_COPY.stepOneGripDetail}>
        <AnswerGroup<GripModeValue>
          options={GRIP_MODE_OPTIONS}
          value={values.gripMode}
          onChange={(value) => set('gripMode', value)}
          groupLabel={SETUP_COPY.stepOneGrip}
          testID="climbing-grip"
        />
      </Question>

      <Stepper
        label={SETUP_COPY.stepOneCeiling}
        value={values.fingerPainCeiling}
        onChange={(next) => set('fingerPainCeiling', next)}
        step={1}
        min={CEILING_MIN}
        max={CEILING_MAX}
        suffix="/ 10"
        format={formatInteger}
        helper={SETUP_COPY.stepOneCeilingDetail}
        {...(errorFor('fingerPainCeiling') === undefined
          ? null
          : { error: errorFor('fingerPainCeiling') })}
        testID="climbing-ceiling"
      />

      <Question label={SETUP_COPY.stepOneWallDays} detail={SETUP_COPY.stepOneWallDaysDetail}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {WEEKDAY_CHIPS.map((day) => (
            <Chip
              key={day.value}
              label={day.label}
              role="checkbox"
              selected={values.wallWorkDays.includes(day.value)}
              onPress={() => toggleDay(day.value)}
              testID={`climbing-wall-day-${day.value}`}
            />
          ))}
        </View>
      </Question>

      <View style={{ gap: space.lg }}>
        <Field
          label={SETUP_COPY.stepOneWallStart}
          value={values.wallStart}
          onChangeText={(text) => set('wallStart', text)}
          onBlur={() => onTouch?.('wallStart')}
          placeholder="18:00"
          maxLength={5}
          testID="climbing-wall-start"
          {...(errorFor('wallStart') === undefined
            ? { helper: SETUP_COPY.stepOneWallTimeHelper }
            : { error: errorFor('wallStart') })}
        />
        <Field
          label={SETUP_COPY.stepOneWallEnd}
          value={values.wallEnd}
          onChangeText={(text) => set('wallEnd', text)}
          onBlur={() => onTouch?.('wallEnd')}
          placeholder="20:00"
          maxLength={5}
          testID="climbing-wall-end"
          {...(errorFor('wallEnd') === undefined
            ? { helper: SETUP_COPY.stepOneWallTimeHelper }
            : { error: errorFor('wallEnd') })}
        />
      </View>

      <CheckRow
        label={SETUP_COPY.stepOneWallFinger}
        detail={SETUP_COPY.stepOneWallFingerDetail}
        checked={values.wallFingerHard}
        onToggle={(next) => set('wallFingerHard', next)}
        testID="climbing-wall-finger"
      />

      <Stepper
        label={SETUP_COPY.stepOneWallGap}
        value={values.wallGapHours}
        onChange={(next) => set('wallGapHours', next)}
        step={1}
        min={WALL_GAP_MIN}
        max={WALL_GAP_MAX}
        suffix="h"
        format={formatInteger}
        helper={SETUP_COPY.stepOneWallGapDetail}
        {...(errorFor('wallGapHours') === undefined
          ? null
          : { error: errorFor('wallGapHours') })}
        testID="climbing-wall-gap"
      />

      <CheckRow
        label={SETUP_COPY.stepOneValgus}
        detail={SETUP_COPY.stepOneValgusDetail}
        checked={values.valgusControl}
        onToggle={(next) => set('valgusControl', next)}
        testID="climbing-valgus"
      />

      <Question label={SETUP_COPY.stepOneWeakerSide} detail={SETUP_COPY.stepOneWeakerSideDetail}>
        <AnswerGroup<WeakerSideValue>
          options={WEAKER_SIDE_OPTIONS}
          value={values.weakerSide}
          onChange={(value) => set('weakerSide', value)}
          groupLabel={SETUP_COPY.stepOneWeakerSide}
          testID="climbing-weaker-side"
        />
      </Question>
    </View>
  );
}
