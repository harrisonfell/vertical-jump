import { View } from 'react-native';
import { formatInteger } from '@vert/engine/units';
import { formatInValue } from '@vert/engine/analytics';
import { Chip, Hairline, Stepper, Text, space } from '@/ui';
import {
  GCT_MAX_MS,
  HEIGHT_MAX_IN,
  HEIGHT_MIN_IN,
  HEIGHT_STEP_IN,
  derivedRsi,
  type Attempt,
} from './validate';

export interface AttemptRowProps {
  readonly index: number;
  readonly attempt: Attempt;
  readonly rsiMode: boolean;
  /** The device's own RSI reading, kept beside ours as a sanity check. */
  readonly deviceRsi?: number | null;
  readonly error?: string;
  readonly onChange: (attempt: Attempt) => void;
}

/**
 * One attempt: the height the athlete reads off the display, a flag for the
 * reps that left the field, and in RSI mode the contact time beside it.
 *
 * The derived RSI sits under the pair rather than in a field of its own: the
 * app computes it, so showing it as an input would invite editing a number
 * that is not measured.
 *
 * An untyped row shows a muted "0.0" placeholder rather than a value: 6.0 in
 * ink reads as a logged jump, and a stray Save would store it. The placeholder
 * is ink3, the same tone a Field's placeholder carries, so the shape of the
 * number is there and the value plainly is not.
 */
const HEIGHT_PLACEHOLDER = '0.0';
const GCT_PLACEHOLDER = '0';

export function AttemptRow({
  index,
  attempt,
  rsiMode,
  deviceRsi,
  error,
  onChange,
}: AttemptRowProps) {
  const rsi = derivedRsi(attempt.heightIn, attempt.gctMs);
  const number = index + 1;

  return (
    <View style={{ gap: space.sm, paddingBottom: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Stepper
            label={`Attempt ${number}`}
            value={attempt.heightIn ?? HEIGHT_MIN_IN}
            onChange={(heightIn) => onChange({ ...attempt, heightIn })}
            step={HEIGHT_STEP_IN}
            min={0}
            max={HEIGHT_MAX_IN + 10}
            format={(value) => (attempt.heightIn === null ? '' : formatInValue(value))}
            placeholder={HEIGHT_PLACEHOLDER}
            suffix="in"
            editable
            {...(error === undefined ? null : { error })}
            testID={`attempt-${number}-height`}
          />
        </View>
        {/* The chip sits on the stepper's value row: the label above it is
            one label line (16) plus the stepper's own 4px gap. */}
        <View style={{ paddingTop: space.lg + space.xs }}>
          <Chip
            label={attempt.flagged ? 'Flagged' : 'Flag'}
            role="checkbox"
            selected={attempt.flagged}
            onPress={() => onChange({ ...attempt, flagged: !attempt.flagged })}
            accessibilityLabel={`Flag attempt ${number} as outside the field`}
            testID={`attempt-${number}-flag`}
          />
        </View>
      </View>

      {rsiMode ? (
        <View style={{ gap: space.xs }}>
          <Stepper
            label={`Contact time ${number}`}
            value={attempt.gctMs ?? 0}
            onChange={(gctMs) => onChange({ ...attempt, gctMs })}
            step={10}
            min={0}
            max={GCT_MAX_MS + 200}
            format={(value) => (attempt.gctMs === null ? '' : formatInteger(value))}
            placeholder={GCT_PLACEHOLDER}
            suffix="ms"
            editable
            testID={`attempt-${number}-gct`}
          />
          <Text variant="caption" color="ink3" numeric>
            {rsi === null
              ? 'RSI needs a contact time'
              : `RSI ${rsi.toFixed(2)}${
                  deviceRsi === null || deviceRsi === undefined
                    ? ''
                    : ` · device ${deviceRsi.toFixed(2)}`
                }`}
          </Text>
        </View>
      ) : null}

      <Hairline />
    </View>
  );
}
