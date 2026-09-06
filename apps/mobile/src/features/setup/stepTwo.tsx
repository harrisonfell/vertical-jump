import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ASSUMED_SESSION_WINDOW, addDays, formatInteger } from '@vert/engine';
import type { WallWork } from '@vert/engine';
import { defaultWallGapHours } from '@/lib/engineAthlete';
import {
  AnswerGroup,
  Button,
  Chip,
  DateField,
  Field,
  Notice,
  Text,
  useSheet,
  space,
} from '@/ui';
import type { LocalDate } from '@/data';
import { SETUP_COPY, gymWindowDetail } from './copy';
import { CheckRow, Question, StepFrame } from './parts';
import { inventorySummary } from './inventory';
import { InventorySheet } from './inventorySheet';
import {
  READINESS_ITEMS,
  WEEKDAY_CHIPS,
  type SportValue,
  type TrainingAgeValue,
} from './questions';
import { showsClimbingLifts } from './climbing';
import { MaxesBlock } from './maxesBlock';
import { BestSetBlock } from './bestSetBlock';
import { bestSetsHaveErrors, type BestSetField, type BestSetValues } from './bestSets';
import { ReadinessBlock } from './readinessBlock';
import { stepTwoDefaults, type StepTwoValues } from './stepTwoValues';
import { defaultTargetDate, defaultTargetLabel, startAndTargetLine } from './startLine';
import {
  MIN_TARGET_DAYS,
  THREE_DAY_LINE,
  feasibilityLine,
  firstRefusal,
  orderWeekdays,
  validateStepTwo,
  type MeasureMode,
  type StepTwoField,
} from './stepTwoValidation';

/**
 * Step 2 collects what the rule book is silent on.
 *
 * Two refusals are hard and never soften: the goal has to be above where you
 * are now, and the target date has to be at least two weeks out. The weekday
 * refusal comes from the engine and says its rule number out loud, which is
 * the one place on the athlete's path a rule number belongs.
 */

export {
  STEP_TWO_DEFAULTS,
  stepTwoDefaults,
  type ReadinessAnswers,
  type StepTwoValues,
} from './stepTwoValues';

export interface SetupStepTwoProps {
  readonly initial?: Partial<StepTwoValues>;
  readonly today: LocalDate;
  readonly onSave: (values: StepTwoValues) => void;
  /** From step 1. Below 1-3 years the readiness checklist does not apply. */
  readonly trainingAge: TrainingAgeValue;
  /** From step 1. It decides which lifts have an entered 1RM row. */
  readonly sport: SportValue;
  /**
   * From step 1, for a climber. With it the weekday refusal is checked
   * against the wall-aware placement, so a pick that cannot carry the
   * upper-power day is refused here in the engine's own words, and the form
   * asks when the athlete lifts, because that is what the placement reads
   * the picks against.
   */
  readonly wallWork?: WallWork | null;
  /** From step 1. A reported lower-limb site keeps depth jumps off. */
  readonly lowerLimbPain: boolean;
  readonly submitLabel?: string;
  readonly saving?: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly framed?: boolean;
}

export function SetupStepTwo({
  initial,
  today,
  onSave,
  trainingAge,
  sport,
  wallWork = null,
  lowerLimbPain,
  submitLabel = SETUP_COPY.stepTwoSubmit,
  saving = false,
  error,
  onRetry,
  framed = true,
}: SetupStepTwoProps) {
  const [values, setValues] = useState<StepTwoValues>({ ...stepTwoDefaults(), ...initial });
  const [blurred, setBlurred] = useState<ReadonlySet<StepTwoField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const inventorySheet = useSheet();

  const set = <K extends keyof StepTwoValues>(key: K, value: StepTwoValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const touch = (field: StepTwoField): void => {
    setBlurred((current) => new Set(current).add(field));
  };

  const result = useMemo(
    () => validateStepTwo(values, { today, sport, wallWork }),
    [today, values, sport, wallWork],
  );
  const errorFor = (field: StepTwoField): string | undefined =>
    submitted || blurred.has(field) ? result.errors[field] : undefined;

  const picks = orderWeekdays(values.weekdays);
  // The plain sentence above the date field: which day week 1 begins, and how
  // long the cycle runs to the date on file or to the one on offer. It says
  // nothing until a weekday is picked, and neither does the date on offer,
  // because both are counted from day 0 and there is no day 0 yet.
  const startLine = startAndTargetLine({ today, weekdays: picks, targetDate: values.targetDate });
  const feasibility =
    result.currentIn === null ||
    result.goalValue === null ||
    result.errors.goalIn !== undefined ||
    result.errors.targetDate !== undefined
      ? null
      : feasibilityLine({
          currentIn: result.currentIn,
          goalIn: result.goalValue,
          targetDate: values.targetDate.trim(),
          today,
          weekdays: picks,
        });

  const showReadiness = trainingAge === '1to3' || trainingAge === '4plus';

  const toggleWeekday = (day: number): void => {
    const next = values.weekdays.includes(day)
      ? values.weekdays.filter((entry) => entry !== day)
      : [...values.weekdays, day];
    set('weekdays', orderWeekdays(next));
    touch('weekdays');
  };

  // The two-week floor, said once: the picker will not offer a day the
  // refusal would turn down, and the same day is where it opens with no
  // weekday picked yet.
  const earliestTarget = addDays(today, MIN_TARGET_DAYS);

  const bestSetsRefused = bestSetsHaveErrors(values.bestSets, today);

  // The save button sits a screen below the field that refused, so once a
  // save was tried the topmost refusal is repeated beside the button.
  const refusal = !submitted
    ? null
    : (firstRefusal(result.errors) ??
      (bestSetsRefused ? SETUP_COPY.stepTwoBestSetIncomplete : null));

  // A climber with a wall on file is asked when they lift: the engine places
  // the week's hard pulling day against the two windows, and without an
  // answer it assumes one, which for an evening climber refuses every pick.
  const wall = showsClimbingLifts(sport) ? wallWork : null;

  const setBestSet = (field: BestSetField, next: BestSetValues): void => {
    set('bestSets', { ...values.bestSets, [field]: next });
  };

  const submit = (): void => {
    setSubmitted(true);
    if (!result.ok || bestSetsRefused) return;
    onSave({ ...values, weekdays: picks });
  };

  const body = (
    <View style={{ gap: space.xl }}>
      <Question label={SETUP_COPY.stepTwoMeasure}>
        <AnswerGroup<MeasureMode>
          options={[
            {
              value: 'device',
              label: SETUP_COPY.stepTwoMeasureDevice,
              detail: SETUP_COPY.stepTwoMeasureDeviceDetail,
            },
            {
              value: 'reach',
              label: SETUP_COPY.stepTwoMeasureReach,
              detail: SETUP_COPY.stepTwoMeasureReachDetail,
            },
          ]}
          value={values.measure}
          onChange={(value) => set('measure', value)}
          groupLabel={SETUP_COPY.stepTwoMeasure}
          testID="step-two-measure"
        />
      </Question>

      {values.measure === 'device' ? (
        <Field
          label={SETUP_COPY.stepTwoBaselineLabel}
          value={values.baselineIn}
          onChangeText={(text) => set('baselineIn', text)}
          onBlur={() => touch('baselineIn')}
          numeric
          suffix="in"
          testID="step-two-baseline"
          {...(errorFor('baselineIn') === undefined
            ? { helper: 'Read straight off the OVR Jump, to 0.1 in.' }
            : { error: errorFor('baselineIn') })}
        />
      ) : (
        <View style={{ gap: space.lg }}>
          <Field
            label={SETUP_COPY.stepTwoReachLabel}
            value={values.reachIn}
            onChangeText={(text) => set('reachIn', text)}
            onBlur={() => touch('reachIn')}
            numeric
            suffix="in"
            testID="step-two-reach"
            {...(errorFor('reachIn') === undefined
              ? { helper: 'Standing, one arm up, flat feet.' }
              : { error: errorFor('reachIn') })}
          />
          <Field
            label={SETUP_COPY.stepTwoTouchLabel}
            value={values.touchIn}
            onChangeText={(text) => set('touchIn', text)}
            onBlur={() => touch('touchIn')}
            numeric
            suffix="in"
            testID="step-two-touch"
            {...(errorFor('touchIn') === undefined
              ? { helper: 'The highest mark you touched. Stored on the Vertec stream.' }
              : { error: errorFor('touchIn') })}
          />
        </View>
      )}

      <CheckRow
        label={SETUP_COPY.stepTwoCanonical}
        detail={SETUP_COPY.stepTwoCanonicalDetail}
        checked={values.canonical}
        onToggle={(next) => set('canonical', next)}
        testID="step-two-canonical"
      />

      <Field
        label={SETUP_COPY.stepTwoGoalLabel}
        value={values.goalIn}
        onChangeText={(text) => set('goalIn', text)}
        onBlur={() => touch('goalIn')}
        numeric
        suffix="in"
        testID="step-two-goal"
        {...(errorFor('goalIn') === undefined ? null : { error: errorFor('goalIn') })}
      />

      {startLine === null ? null : (
        <Text variant="caption" color="ink2" numeric testID="step-two-start-line">
          {startLine}
        </Text>
      )}

      <DateField
        label={SETUP_COPY.stepTwoTargetLabel}
        value={values.targetDate}
        onChangeText={(text) => set('targetDate', text)}
        onBlur={() => touch('targetDate')}
        minimumDate={earliestTarget}
        defaultDate={picks.length === 0 ? earliestTarget : defaultTargetDate(today, picks)}
        emptyLabel="Pick a date"
        testID="step-two-target"
        {...(errorFor('targetDate') === undefined
          ? { helper: SETUP_COPY.stepTwoTargetHelper }
          : { error: errorFor('targetDate') })}
      />

      {values.targetDate.trim() === '' && picks.length > 0 ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={defaultTargetLabel(today, picks)}
            variant="secondary"
            onPress={() => {
              set('targetDate', defaultTargetDate(today, picks));
              touch('targetDate');
            }}
            testID="step-two-target-default"
          />
        </View>
      ) : null}

      {feasibility === null ? null : <Notice text={feasibility} testID="step-two-feasibility" live />}

      <Question
        label={SETUP_COPY.stepTwoWeekdays}
        detail={`Pick ${formatInteger(values.daysPerWeek)}. The order you train them is the template order.`}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {WEEKDAY_CHIPS.map((day) => (
            <Chip
              key={day.value}
              label={day.label}
              role="checkbox"
              selected={values.weekdays.includes(day.value)}
              onPress={() => toggleWeekday(day.value)}
              testID={`step-two-weekday-${day.value}`}
            />
          ))}
        </View>
        {errorFor('weekdays') === undefined ? null : (
          <Text
            variant="caption"
            color="ink"
            accessibilityLiveRegion="polite"
            role="alert"
            testID="step-two-weekday-error"
          >
            {result.errors.weekdays}
          </Text>
        )}
        {values.daysPerWeek === 3 ? (
          <Text variant="caption" color="ink3">
            {THREE_DAY_LINE}
          </Text>
        ) : null}
      </Question>

      {wall === null ? null : (
        <Question
          label={SETUP_COPY.stepTwoGym}
          detail={gymWindowDetail(
            wall.sameDayGapHours ?? defaultWallGapHours(),
            ASSUMED_SESSION_WINDOW,
          )}
        >
          <View style={{ gap: space.lg }}>
            <Field
              label={SETUP_COPY.stepTwoGymStart}
              value={values.gymStart}
              onChangeText={(text) => set('gymStart', text)}
              onBlur={() => touch('gymStart')}
              placeholder="08:00"
              maxLength={5}
              testID="step-two-gym-start"
              {...(errorFor('gymStart') === undefined
                ? { helper: SETUP_COPY.stepTwoGymTimeHelper }
                : { error: errorFor('gymStart') })}
            />
            <Field
              label={SETUP_COPY.stepTwoGymEnd}
              value={values.gymEnd}
              onChangeText={(text) => set('gymEnd', text)}
              onBlur={() => touch('gymEnd')}
              placeholder="10:00"
              maxLength={5}
              testID="step-two-gym-end"
              {...(errorFor('gymEnd') === undefined ? null : { error: errorFor('gymEnd') })}
            />
          </View>
        </Question>
      )}

      <Question label={SETUP_COPY.stepTwoInventory}>
        <Text variant="body" color="ink2" testID="step-two-inventory-summary">
          {inventorySummary(values.inventory)}
        </Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={SETUP_COPY.stepTwoInventoryEdit}
            variant="secondary"
            onPress={inventorySheet.show}
            testID="step-two-inventory-edit"
          />
        </View>
      </Question>

      <Field
        label={SETUP_COPY.stepTwoBodyweight}
        value={values.bodyweightLb}
        onChangeText={(text) => set('bodyweightLb', text)}
        onBlur={() => touch('bodyweightLb')}
        numeric
        suffix="lb"
        testID="step-two-bodyweight"
        {...(errorFor('bodyweightLb') === undefined
          ? { helper: 'Used for loaded jumps and the bodyweight rows.' }
          : { error: errorFor('bodyweightLb') })}
      />

      <MaxesBlock
        sport={sport}
        values={values}
        onChange={(field, text) => set(field, text)}
        onBlur={touch}
        errorFor={errorFor}
      />

      <BestSetBlock
        sport={sport}
        values={values.bestSets}
        onChange={setBestSet}
        today={today}
        submitted={submitted}
      />

      {showsClimbingLifts(sport) ? (
        <ReadinessBlock
          values={values.readinessConfig}
          onChange={(next) => set('readinessConfig', next)}
        />
      ) : null}

      <CheckRow
        label={SETUP_COPY.stepTwoInSeason}
        detail={SETUP_COPY.stepTwoInSeasonDetail}
        checked={values.inSeason}
        onToggle={(next) => set('inSeason', next)}
        testID="step-two-in-season"
      />

      {showReadiness ? (
        <Question
          label={SETUP_COPY.stepTwoReadiness}
          detail="All four have to be true before depth jumps are ever prescribed."
        >
          <View>
            {READINESS_ITEMS.map((item) =>
              item.key === 'pain' ? (
                <CheckRow
                  key={item.key}
                  label={SETUP_COPY.stepTwoReadinessPainOk}
                  {...(lowerLimbPain ? { detail: SETUP_COPY.stepTwoReadinessPainNo } : null)}
                  checked={!lowerLimbPain && values.readiness.pain}
                  disabled={lowerLimbPain}
                  onToggle={(next) => set('readiness', { ...values.readiness, pain: next })}
                  testID="step-two-readiness-pain"
                />
              ) : (
                <CheckRow
                  key={item.key}
                  label={item.label}
                  checked={values.readiness[item.key]}
                  onToggle={(next) => set('readiness', { ...values.readiness, [item.key]: next })}
                  testID={`step-two-readiness-${item.key}`}
                />
              ),
            )}
          </View>
        </Question>
      ) : null}

      {error === undefined ? null : (
        <Notice
          text={error}
          detail="Your answers are still here."
          {...(onRetry === undefined ? null : { actionLabel: 'Retry', onAction: onRetry })}
          live
        />
      )}

      {refusal === null ? null : (
        <Notice
          text={refusal}
          detail={SETUP_COPY.stepTwoRefusalDetail}
          live
          testID="step-two-refusal"
        />
      )}

      <Button
        label={submitLabel}
        onPress={submit}
        fullWidth
        loading={saving}
        testID="step-two-save"
      />

      <InventorySheet
        visible={inventorySheet.open}
        onClose={inventorySheet.hide}
        value={values.inventory}
        onSave={(next) => {
          set('inventory', next);
          inventorySheet.hide();
        }}
      />
    </View>
  );

  if (!framed) return body;
  return (
    <StepFrame step={2} title={SETUP_COPY.stepTwoTitle}>
      {body}
    </StepFrame>
  );
}
