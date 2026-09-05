import { View } from 'react-native';
import { ChipRow, DateField, Field, Text, space } from '@/ui';
import type { LocalDate } from '@/data';
import { SETUP_COPY } from './copy';
import { Question } from './parts';
import { maxRowsFor } from './maxLifts';
import type { SportValue } from './questions';
import {
  RPE_CHIPS,
  bestSetSummary,
  emptyBestSet,
  isAddedLoadField,
  validateBestSet,
  type BestSetField,
  type BestSetValues,
  type BestSetsDraft,
} from './bestSets';

/**
 * The best recent set, one per main lift.
 *
 * The same block in setup step 2 and in Settings > Lifts, so a set means the
 * same thing on the day it is changed as it did on the day it was typed. The
 * caption states R73's near-max test in plain words, and the line under a
 * typed set says which side of it that set fell on.
 */

const RPE_OPTIONS = RPE_CHIPS.map((value) => ({ value, label: `${value}` }));

export interface BestSetBlockProps {
  readonly sport: SportValue;
  readonly values: BestSetsDraft;
  readonly onChange: (field: BestSetField, values: BestSetValues) => void;
  readonly today: LocalDate;
  /** Set once the form was submitted: every refusal shows from then on. */
  readonly submitted?: boolean;
  /** Off in Settings, where the section already carries its own heading. */
  readonly framed?: boolean;
}

export function BestSetBlock({
  sport,
  values,
  onChange,
  today,
  submitted = false,
  framed = true,
}: BestSetBlockProps) {
  const rows = maxRowsFor(sport);

  const body = (
    <View style={{ gap: space.xl }}>
      {rows.map((row) => {
        const field: BestSetField = row.field;
        const set = values[field] ?? emptyBestSet(today);
        const errors = validateBestSet(set, field, today);
        const show = (key: 'reps' | 'loadLb' | 'date'): string | undefined =>
          submitted ? errors[key] : undefined;
        const summary = bestSetSummary(set);
        const put = (patch: Partial<BestSetValues>): void => {
          onChange(field, { ...set, ...patch });
        };

        return (
          <View key={field} style={{ gap: space.md }} testID={`best-set-${field}`}>
            <Text variant="label" color="ink3">
              {row.label}
            </Text>
            <Field
              label={SETUP_COPY.stepTwoBestSetReps}
              value={set.reps}
              onChangeText={(text) => put({ reps: text })}
              numeric
              testID={`best-set-reps-${field}`}
              {...(show('reps') === undefined ? null : { error: show('reps') })}
            />
            <Field
              label={
                isAddedLoadField(field)
                  ? SETUP_COPY.stepTwoBestSetAddedLoad
                  : SETUP_COPY.stepTwoBestSetLoad
              }
              value={set.loadLb}
              onChangeText={(text) => put({ loadLb: text })}
              numeric
              suffix="lb"
              testID={`best-set-load-${field}`}
              {...(show('loadLb') === undefined ? null : { error: show('loadLb') })}
            />
            <View style={{ gap: space.sm }}>
              <Text variant="label" color="ink3">
                {SETUP_COPY.stepTwoBestSetRpe}
              </Text>
              <ChipRow<number>
                options={RPE_OPTIONS}
                value={set.rpe}
                onChange={(value) => put({ rpe: value })}
                groupLabel={`${row.label} ${SETUP_COPY.stepTwoBestSetRpe}`}
                splitAfter={5}
                testID={`best-set-rpe-${field}`}
              />
            </View>
            <DateField
              label={SETUP_COPY.stepTwoBestSetDate}
              value={set.date}
              onChangeText={(text) => put({ date: text })}
              maximumDate={today}
              defaultDate={today}
              testID={`best-set-date-${field}`}
              {...(show('date') === undefined
                ? { helper: SETUP_COPY.stepTwoBestSetDateHelper }
                : { error: show('date') })}
            />
            {summary === null ? null : (
              <Text variant="caption" color="ink3" testID={`best-set-summary-${field}`}>
                {summary}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );

  if (!framed) return body;
  return (
    <Question label={SETUP_COPY.stepTwoBestSetTitle} detail={SETUP_COPY.stepTwoBestSetCaption}>
      {body}
    </Question>
  );
}
