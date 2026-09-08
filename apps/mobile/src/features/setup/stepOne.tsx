import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { AnswerGroup, Button, Notice, space } from '@/ui';
import { SETUP_COPY } from './copy';
import { Question, StepFrame } from './parts';
import {
  AVAILABILITY_OPTIONS,
  PAIN_DURATION_OPTIONS,
  PAIN_LOCATION_OPTIONS,
  PAIN_SEVERITY_OPTIONS,
  SECONDARY_GOAL_OPTIONS,
  SPORT_OPTIONS,
  TRAINING_AGE_OPTIONS,
  type PainLocationValue,
  type SportValue,
  type TrainingAgeValue,
} from './questions';
import { ClimbingBlock } from './climbingBlock';
import {
  climbingDefaults,
  showsGripBlock,
  validateClimbing,
  type ClimbingAnswers,
  type ClimbingField,
} from './climbing';

/**
 * The ThisFiTT onboarding, verbatim, as plain single-select rows in its order.
 *
 * Exported as a component so Settings edits the same five answers with the
 * same words: it takes the values it starts from and hands back the values it
 * ends with, and knows nothing about routing or the database.
 */

export interface StepOneValues extends ClimbingAnswers {
  readonly sport: SportValue;
  readonly trainingAge: TrainingAgeValue;
  readonly daysPerWeek: 2 | 3 | 4 | 5;
  readonly hasPain: boolean;
  readonly painLocation: PainLocationValue | null;
  readonly painSeverity: 1 | 3 | 5 | null;
  readonly painDuration: 'acute' | 'chronic' | null;
}

/** Basketball and 4 days, plus climbing answers that read as never asked. */
export function stepOneDefaults(): StepOneValues {
  return {
    ...climbingDefaults(),
    sport: 'basketball',
    trainingAge: '1to3',
    daysPerWeek: 4,
    hasPain: false,
    painLocation: null,
    painSeverity: null,
    painDuration: null,
  };
}

/** The same starting point as a value, for a caller that wants one. */
export const STEP_ONE_DEFAULTS: StepOneValues = stepOneDefaults();

export interface SetupStepOneProps {
  readonly initial?: Partial<StepOneValues>;
  readonly onSave: (values: StepOneValues) => void;
  readonly submitLabel?: string;
  readonly saving?: boolean;
  /** A save that failed, in plain words. The answers stay on screen. */
  readonly error?: string;
  readonly onRetry?: () => void;
  /** Set on the setup route; Settings renders its own frame. */
  readonly framed?: boolean;
}

export function SetupStepOne({
  initial,
  onSave,
  submitLabel = SETUP_COPY.stepOneSubmit,
  saving = false,
  error,
  onRetry,
  framed = true,
}: SetupStepOneProps) {
  const defaults = STEP_ONE_DEFAULTS;
  const [sport, setSport] = useState<SportValue>(initial?.sport ?? defaults.sport);
  const [trainingAge, setTrainingAge] = useState<TrainingAgeValue>(
    initial?.trainingAge ?? STEP_ONE_DEFAULTS.trainingAge,
  );
  const [daysPerWeek, setDaysPerWeek] = useState<2 | 3 | 4 | 5>(
    initial?.daysPerWeek ?? STEP_ONE_DEFAULTS.daysPerWeek,
  );
  const [hasPain, setHasPain] = useState<boolean>(initial?.hasPain ?? false);
  const [painLocation, setPainLocation] = useState<PainLocationValue | null>(
    initial?.painLocation ?? null,
  );
  const [painSeverity, setPainSeverity] = useState<1 | 3 | 5 | null>(
    initial?.painSeverity ?? null,
  );
  const [painDuration, setPainDuration] = useState<'acute' | 'chronic' | null>(
    initial?.painDuration ?? null,
  );
  // Field by field rather than a spread: `initial` is a Partial whose absent
  // keys are present and undefined, and a spread would overwrite a default
  // with one of them.
  const [climbing, setClimbing] = useState<ClimbingAnswers>({
    secondaryGoal: initial?.secondaryGoal ?? defaults.secondaryGoal,
    fingerHistory: initial?.fingerHistory ?? defaults.fingerHistory,
    gripMode: initial?.gripMode ?? defaults.gripMode,
    fingerPainCeiling: initial?.fingerPainCeiling ?? defaults.fingerPainCeiling,
    wallWorkDays: initial?.wallWorkDays ?? defaults.wallWorkDays,
    wallStart: initial?.wallStart ?? defaults.wallStart,
    wallEnd: initial?.wallEnd ?? defaults.wallEnd,
    wallFingerHard: initial?.wallFingerHard ?? defaults.wallFingerHard,
    wallGapHours: initial?.wallGapHours ?? defaults.wallGapHours,
    valgusControl: initial?.valgusControl ?? defaults.valgusControl,
    weakerSide: initial?.weakerSide ?? defaults.weakerSide,
  });
  const [climbTouched, setClimbTouched] = useState<ReadonlySet<ClimbingField>>(new Set());
  const [touched, setTouched] = useState(false);

  const showGrip = showsGripBlock(sport, climbing.fingerHistory);
  const climbResult = validateClimbing(climbing);

  const complete = useMemo(() => {
    if (!hasPain) return true;
    return painLocation !== null && painSeverity !== null && painDuration !== null;
  }, [hasPain, painDuration, painLocation, painSeverity]);

  const submit = (): void => {
    setTouched(true);
    if (!complete) return;
    if (showGrip && !climbResult.ok) return;
    onSave({
      ...climbing,
      sport,
      trainingAge,
      daysPerWeek,
      hasPain,
      painLocation: hasPain ? painLocation : null,
      painSeverity: hasPain ? painSeverity : null,
      painDuration: hasPain ? painDuration : null,
    });
  };

  const body = (
    <View style={{ gap: space.xl }}>
      <Question
        label={SETUP_COPY.stepOneSecondGoal}
        detail={SETUP_COPY.stepOneSecondGoalDetail}
      >
        <AnswerGroup
          options={SECONDARY_GOAL_OPTIONS}
          value={climbing.secondaryGoal ?? 'none'}
          onChange={(value) =>
            setClimbing((current) => ({
              ...current,
              secondaryGoal: value === 'none' ? null : value,
            }))
          }
          groupLabel={SETUP_COPY.stepOneSecondGoal}
          testID="step-one-second-goal"
        />
      </Question>

      <Question label={SETUP_COPY.stepOneSport}>
        <AnswerGroup
          options={SPORT_OPTIONS}
          value={sport}
          onChange={setSport}
          groupLabel={SETUP_COPY.stepOneSport}
          testID="step-one-sport"
        />
      </Question>

      <Question label={SETUP_COPY.stepOneTrainingAge}>
        <AnswerGroup
          options={TRAINING_AGE_OPTIONS}
          value={trainingAge}
          onChange={setTrainingAge}
          groupLabel={SETUP_COPY.stepOneTrainingAge}
          testID="step-one-training-age"
        />
      </Question>

      <Question label={SETUP_COPY.stepOneAvailability}>
        <AnswerGroup
          options={AVAILABILITY_OPTIONS}
          value={daysPerWeek}
          onChange={setDaysPerWeek}
          groupLabel={SETUP_COPY.stepOneAvailability}
          testID="step-one-days"
        />
      </Question>

      <Question label={SETUP_COPY.stepOnePain}>
        <AnswerGroup
          options={[
            { value: 'no', label: 'No' },
            { value: 'yes', label: 'Yes' },
          ]}
          value={hasPain ? 'yes' : 'no'}
          onChange={(value) => setHasPain(value === 'yes')}
          groupLabel={SETUP_COPY.stepOnePain}
          testID="step-one-pain"
        />
      </Question>

      {hasPain ? (
        <View style={{ gap: space.xl }}>
          <Question label={SETUP_COPY.stepOnePainLocation}>
            <AnswerGroup
              options={PAIN_LOCATION_OPTIONS}
              value={painLocation}
              onChange={setPainLocation}
              groupLabel={SETUP_COPY.stepOnePainLocation}
              testID="step-one-pain-location"
            />
          </Question>

          <Question label={SETUP_COPY.stepOnePainSeverity}>
            <AnswerGroup
              options={PAIN_SEVERITY_OPTIONS}
              value={painSeverity}
              onChange={setPainSeverity}
              groupLabel={SETUP_COPY.stepOnePainSeverity}
              testID="step-one-pain-severity"
            />
          </Question>

          <Question
            label={SETUP_COPY.stepOnePainDuration}
            detail={SETUP_COPY.stepOnePainDurationDetail}
          >
            <AnswerGroup
              options={PAIN_DURATION_OPTIONS}
              value={painDuration}
              onChange={setPainDuration}
              groupLabel={SETUP_COPY.stepOnePainDuration}
              testID="step-one-pain-duration"
            />
          </Question>
        </View>
      ) : null}

      <Question
        label={SETUP_COPY.stepOneFingerHistory}
        detail={SETUP_COPY.stepOneFingerHistoryDetail}
      >
        <AnswerGroup
          options={[
            { value: 'no', label: 'No' },
            { value: 'yes', label: 'Yes' },
          ]}
          value={climbing.fingerHistory ? 'yes' : 'no'}
          onChange={(value) =>
            setClimbing((current) => ({ ...current, fingerHistory: value === 'yes' }))
          }
          groupLabel={SETUP_COPY.stepOneFingerHistory}
          testID="step-one-finger-history"
        />
      </Question>

      {showGrip ? (
        <ClimbingBlock
          values={climbing}
          onChange={setClimbing}
          touched={climbTouched}
          onTouch={(field) => setClimbTouched((current) => new Set(current).add(field))}
          submitted={touched}
        />
      ) : null}

      {touched && !complete ? <Notice text={SETUP_COPY.stepOneIncomplete} live /> : null}
      {error === undefined ? null : (
        <Notice
          text={error}
          detail="Your answers are still here."
          {...(onRetry === undefined ? null : { actionLabel: 'Retry', onAction: onRetry })}
          live
        />
      )}

      <Button
        label={submitLabel}
        onPress={submit}
        fullWidth
        loading={saving}
        testID="step-one-save"
      />
    </View>
  );

  if (!framed) return body;
  return (
    <StepFrame step={1} title={SETUP_COPY.stepOneTitle}>
      {body}
    </StepFrame>
  );
}
