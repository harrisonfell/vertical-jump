import { View } from 'react-native';
import type { ReadinessTestConfig } from '@vert/engine';
import { readinessTestNoun } from '@vert/engine';
import { Stepper, Text, space } from '@/ui';
import { AttemptRow } from './attemptRow';
import { readSingleLeg, singleLegIssues } from './singleLeg';
import { formatThrowValue, readThrow, throwStep, throwUnit } from './throwTest';
import { rightAttemptsOf, type Attempt, type TestDraft } from './validate';

/**
 * The two streams that are not the jump stream: the single-leg pair and the
 * readiness throw.
 *
 * They share the sheet's shell, its Save button and its notes field, and they
 * share the attempt row where the shape of the number is the same. What they
 * do not share is the canonical flag, the PR preview or the trend: neither of
 * them is the stream the one big number is read from, and each says so on the
 * panel rather than leaving it to be discovered.
 */

export interface SingleLegPanelProps {
  readonly draft: TestDraft;
  readonly onChange: (draft: TestDraft) => void;
}

/**
 * Three attempts a side, left first because the weaker side goes first on
 * unilateral work (`house.sc.weaker_side_first`), with the gap computed live
 * from the best unflagged attempt on each side.
 */
export function SingleLegPanel({ draft, onChange }: SingleLegPanelProps) {
  const reading = readSingleLeg(draft);
  const issues = singleLegIssues(draft);

  const setLeft = (index: number, attempt: Attempt): void => {
    onChange({
      ...draft,
      attempts: draft.attempts.map((entry, position) => (position === index ? attempt : entry)),
    });
  };
  const setRight = (index: number, attempt: Attempt): void => {
    onChange({
      ...draft,
      rightAttempts: rightAttemptsOf(draft).map((entry, position) =>
        position === index ? attempt : entry,
      ),
    });
  };

  const errorFor = (side: 'left' | 'right', index: number): string | undefined =>
    (side === 'left' ? issues.left : issues.right).find(
      (issue) => issue.index === index && issue.blocking,
    )?.message;

  return (
    <View style={{ gap: space.lg }} testID="single-leg-panel">
      <View>
        <Text variant="label" color="ink2">
          Left leg
        </Text>
        {draft.attempts.map((attempt, index) => (
          <AttemptRow
            key={`left-${index}`}
            index={index}
            attempt={attempt}
            rsiMode={false}
            {...(errorFor('left', index) === undefined
              ? null
              : { error: errorFor('left', index) })}
            onChange={(next) => setLeft(index, next)}
          />
        ))}
      </View>

      <View>
        <Text variant="label" color="ink2">
          Right leg
        </Text>
        {rightAttemptsOf(draft).map((attempt, index) => (
          <AttemptRow
            key={`right-${index}`}
            index={index}
            attempt={attempt}
            rsiMode={false}
            {...(errorFor('right', index) === undefined
              ? null
              : { error: errorFor('right', index) })}
            onChange={(next) => setRight(index, next)}
          />
        ))}
      </View>

      <Text
        variant="body"
        color="ink"
        numeric
        accessibilityLiveRegion="polite"
        style={{ maxWidth: 560 }}
        testID="single-leg-summary"
      >
        {reading.line}
      </Text>
      <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
        A single-leg test is its own stream. It is never canonical, never sets a personal record,
        and never moves the trend or the pace. It decides which leg goes first.
      </Text>
    </View>
  );
}

export interface ThrowPanelProps {
  readonly attempts: readonly (number | null)[];
  readonly config: ReadinessTestConfig;
  readonly onChange: (attempts: readonly (number | null)[]) => void;
}

/**
 * The readiness test's attempts, in the metric the athlete configured. The
 * day's number is the best of them, derived rather than typed twice, and the
 * gate scores it against the rolling median of the sessions before it.
 */
export function ThrowPanel({ attempts, config, onChange }: ThrowPanelProps) {
  const reading = readThrow(attempts, config);
  const noun = readinessTestNoun(config.kind);
  const unit = throwUnit(config.metric);
  const step = throwStep(config.metric);

  const errorFor = (index: number): string | undefined =>
    reading.issues.find((issue) => issue.index === index && issue.blocking)?.message;

  return (
    <View style={{ gap: space.md }} testID="throw-panel">
      {attempts.map((value, index) => {
        const error = errorFor(index);
        return (
          <Stepper
            key={`throw-${index}`}
            label={`Attempt ${index + 1}`}
            value={value ?? 0}
            onChange={(next) => onChange(attempts.map((entry, at) => (at === index ? next : entry)))}
            step={step}
            min={0}
            max={config.metric === 'rsi' ? 6 : config.metric === 'height_in' ? 70 : 25}
            format={(entry) => (value === null ? '' : formatThrowValue(entry, config.metric))}
            placeholder={config.metric === 'rsi' ? '0.00' : '0.0'}
            {...(unit === '' ? null : { suffix: unit })}
            editable
            {...(error === undefined ? null : { error })}
            testID={`throw-${index + 1}`}
          />
        );
      })}

      <Text
        variant="body"
        color="ink"
        numeric
        accessibilityLiveRegion="polite"
        testID="throw-summary"
      >
        {reading.summary}
      </Text>
      <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
        {`The best ${noun} is today's number. It is channel B of the readiness gate, never a jump test and never a personal record.`}
      </Text>
    </View>
  );
}
