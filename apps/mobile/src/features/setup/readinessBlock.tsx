import { View } from 'react-native';
import { formatInteger } from '@vert/engine';
import { AnswerGroup, Stepper, space } from '@/ui';
import type { ReadinessTestKind } from '@vert/engine';
import { SETUP_COPY } from './copy';
import { Question } from './parts';
import { READINESS_KIND_OPTIONS } from './questions';
import {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  WINDOW_MAX,
  WINDOW_MIN,
  type ReadinessConfigValues,
} from './readinessConfig';

/**
 * Channel B of the readiness gate, configured rather than hardcoded
 * (house `house.sc.readiness_gate`).
 *
 * The same block runs in setup step 2 and in the Settings sheet, so the test
 * an athlete swaps to in Settings is described in the words it was first
 * offered in.
 */

export interface ReadinessBlockProps {
  readonly values: ReadinessConfigValues;
  readonly onChange: (values: ReadinessConfigValues) => void;
}

export function ReadinessBlock({ values, onChange }: ReadinessBlockProps) {
  const set = <K extends keyof ReadinessConfigValues>(
    key: K,
    value: ReadinessConfigValues[K],
  ): void => {
    onChange({ ...values, [key]: value });
  };

  return (
    <View style={{ gap: space.xl }} testID="readiness-config-block">
      <Question
        label={SETUP_COPY.stepTwoReadinessTest}
        detail={SETUP_COPY.stepTwoReadinessTestDetail}
      >
        <AnswerGroup<ReadinessTestKind>
          options={READINESS_KIND_OPTIONS}
          value={values.kind}
          onChange={(value) => set('kind', value)}
          groupLabel={SETUP_COPY.stepTwoReadinessTest}
          testID="readiness-kind"
        />
      </Question>

      <Stepper
        label={SETUP_COPY.stepTwoReadinessAttempts}
        value={values.attempts}
        onChange={(next) => set('attempts', next)}
        step={1}
        min={ATTEMPTS_MIN}
        max={ATTEMPTS_MAX}
        format={formatInteger}
        helper={SETUP_COPY.stepTwoReadinessAttemptsDetail}
        testID="readiness-attempts"
      />

      <Stepper
        label={SETUP_COPY.stepTwoReadinessWindow}
        value={values.baselineWindow}
        onChange={(next) => set('baselineWindow', next)}
        step={1}
        min={WINDOW_MIN}
        max={WINDOW_MAX}
        suffix="tests"
        format={formatInteger}
        helper={SETUP_COPY.stepTwoReadinessWindowDetail}
        testID="readiness-window"
      />

      <Stepper
        label={SETUP_COPY.stepTwoReadinessThreshold}
        value={values.lowThresholdPct}
        onChange={(next) => set('lowThresholdPct', next)}
        step={1}
        min={THRESHOLD_MIN}
        max={THRESHOLD_MAX}
        suffix="%"
        format={formatInteger}
        helper={SETUP_COPY.stepTwoReadinessThresholdDetail}
        testID="readiness-threshold"
      />
    </View>
  );
}
