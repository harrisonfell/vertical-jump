import { useState } from 'react';
import { View } from 'react-native';
import type { ReadinessTestConfig } from '@vert/engine';
import { Button, ButtonRow, Hairline, Stepper, Text, space } from '@/ui';
import {
  attemptStep,
  attemptUnit,
  bareAttemptText,
  bestLine,
  bestOf,
  logLabel,
  saveLabel,
  type ReadinessRowModel,
} from './readinessModel';

/**
 * The readiness row, under the Whoop strip on a training day
 * (house rule `house.sc.readiness_gate`).
 *
 * Two channels on two lines, never averaged and never merged into a score.
 * Channel A is the strap's own number in the strap's own words with the
 * attribution the terms require. Channel B is a throw the athlete makes here,
 * which is why the only control is 44 px and says what it logs. The verdict
 * sits under both in plain words: a state is a sentence, never a coloured pill,
 * because the colour would be the only thing carrying the meaning.
 *
 * The whole row is derived, so changing the entry undoes the adjustment and
 * re-applies it with no undo path of its own.
 */

export interface ReadinessRowProps {
  readonly model: ReadinessRowModel;
  readonly config: ReadinessTestConfig;
  /** True once the athlete declined the test: the entry stays closed. */
  readonly skipped?: boolean;
  /** The attempts, best of them taken as the day's number. */
  readonly onSave: (attempts: readonly number[]) => void;
  readonly onSkip: () => void;
  readonly saving?: boolean;
  /** Names the cause and the fix; the typed attempts are never cleared. */
  readonly saveError?: string | null;
  readonly testID?: string;
}

export function ReadinessRow({
  model,
  config,
  skipped = false,
  onSave,
  onSkip,
  saving = false,
  saveError = null,
  testID,
}: ReadinessRowProps) {
  const [open, setOpen] = useState(false);
  const [attempts, setAttempts] = useState<(number | null)[]>(() =>
    Array.from({ length: Math.max(1, config.attempts) }, () => null),
  );

  const step = attemptStep(config);
  const unit = attemptUnit(config);
  const best = bestOf(attempts);

  const setAttempt = (index: number, value: number): void => {
    setAttempts((current) => current.map((entry, position) => (position === index ? value : entry)));
  };

  return (
    <View testID={testID} style={{ gap: space.sm, paddingBottom: space.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
          minHeight: 44,
        }}
      >
        <Text variant="label" color="ink2">
          Readiness
        </Text>
        {open ? null : (
          <Button
            label={model.logged ? 'Change' : logLabel(config)}
            variant="secondary"
            size={44}
            onPress={() => setOpen(true)}
            testID="readiness-log"
          />
        )}
      </View>

      {model.outcome === null && !model.logged ? (
        <Text variant="caption" color="ink3" numeric>
          {model.caption}
        </Text>
      ) : (
        <View style={{ gap: space.xs }}>
          <Text variant="caption" color="ink2" numeric>
            {model.autonomicLine}
          </Text>
          <Text variant="caption" color="ink2" numeric>
            {model.neuromuscularLine}
          </Text>
          {model.outcomeLine === null ? null : (
            <Text variant="body" color="ink" accessibilityLiveRegion="polite">
              {model.outcomeLine}
            </Text>
          )}
        </View>
      )}

      {open ? (
        <View style={{ gap: space.md, paddingTop: space.sm }} testID="readiness-entry">
          {attempts.map((value, index) => (
            <Stepper
              key={index}
              label={`Attempt ${index + 1}`}
              value={value ?? 0}
              step={step}
              min={0}
              max={100}
              format={(entry) => (entry <= 0 ? '' : bareAttemptText(entry, config))}
              placeholder={bareAttemptText(0, config)}
              {...(unit === '' ? null : { suffix: unit })}
              editable
              onChange={(entry) => setAttempt(index, entry)}
            />
          ))}

          <Text variant="caption" color="ink2" numeric accessibilityLiveRegion="polite">
            {bestLine(attempts, config)}
          </Text>

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

          <ButtonRow>
            <Button
              label={saveLabel(config)}
              variant="primary"
              size={44}
              loading={saving}
              disabled={saving || best === null}
              onPress={() => {
                const typed = attempts.filter(
                  (entry): entry is number => entry !== null && entry > 0,
                );
                onSave(typed);
                setOpen(false);
              }}
              testID="readiness-save"
            />
            <Button
              label="Skip"
              variant="quiet"
              size={44}
              onPress={() => {
                onSkip();
                setOpen(false);
              }}
              testID="readiness-skip"
            />
          </ButtonRow>
        </View>
      ) : null}

      {skipped && !open && !model.logged ? (
        <Text variant="caption" color="ink3">
          Readiness test: skipped
        </Text>
      ) : null}

      <Hairline />
    </View>
  );
}
