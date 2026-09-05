import { View } from 'react-native';
import { Field, space } from '@/ui';
import { SETUP_COPY } from './copy';
import { Question } from './parts';
import type { SportValue } from './questions';
import { maxRowsFor, maxesCaptionFor, type MaxesValues } from './maxLifts';
import type { StepTwoField } from './stepTwoValidation';

/** The entered 1RM rows, which are the sport's main lifts and nothing else. */

export interface MaxesBlockProps {
  readonly sport: SportValue;
  readonly values: MaxesValues;
  readonly onChange: (field: keyof MaxesValues, text: string) => void;
  readonly onBlur: (field: StepTwoField) => void;
  readonly errorFor: (field: StepTwoField) => string | undefined;
}

export function MaxesBlock({ sport, values, onChange, onBlur, errorFor }: MaxesBlockProps) {
  return (
    <Question label={SETUP_COPY.stepTwoMaxesTitle} detail={maxesCaptionFor(sport)}>
      <View style={{ gap: space.lg }}>
        {maxRowsFor(sport).map((row) => (
          <Field
            key={row.field}
            label={row.label}
            value={values[row.field]}
            onChangeText={(text) => onChange(row.field, text)}
            onBlur={() => onBlur(row.field)}
            numeric
            suffix="lb"
            testID={row.testID}
            {...(errorFor(row.field) === undefined
              ? row.helper === undefined
                ? null
                : { helper: row.helper }
              : { error: errorFor(row.field) })}
          />
        ))}
      </View>
    </Question>
  );
}
