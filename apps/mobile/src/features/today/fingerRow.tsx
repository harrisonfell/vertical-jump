import { useState } from 'react';
import { View } from 'react-native';
import { formatInteger } from '@vert/engine/units';
import { Button, ChipRow, Hairline, Text, space, type ChipOption } from '@/ui';

/**
 * "Finger pain today", asked only before a session that carries hard finger
 * work (house rule `house.sc.finger_pain_ceiling`).
 *
 * The same shape as the soreness row, because it is the same kind of question:
 * eleven chips broken after six so the row fits a 390 px screen, each a 44 px
 * target beside a 44 px Skip. An answer over the ceiling takes the hard finger
 * rows out of today and says so; there is no override, because a pulley is not
 * a negotiation. The answer can always be changed, which puts the rows back.
 */

const OPTIONS: readonly ChipOption<number>[] = Array.from({ length: 11 }, (_v, value) => ({
  value,
  label: String(value),
}));

export interface FingerRowProps {
  readonly value: number | null;
  /** True once the athlete has answered, whether or not a number came back. */
  readonly answered?: boolean;
  readonly onAnswer: (value: number) => void;
  readonly onSkip: () => void;
  readonly testID?: string;
}

export function FingerRow({
  value,
  answered = false,
  onAnswer,
  onSkip,
  testID,
}: FingerRowProps) {
  const hasValue = value !== null;
  const [open, setOpen] = useState(!answered);

  if (!open) {
    return (
      <View testID={testID}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.md,
            minHeight: 44,
          }}
        >
          <Text variant="caption" color="ink2" numeric>
            {hasValue
              ? `Finger pain today ${formatInteger(value)}/10`
              : 'Finger pain today: skipped'}
          </Text>
          <Button label="Change" variant="quiet" onPress={() => setOpen(true)} />
        </View>
        <Hairline />
      </View>
    );
  }

  return (
    <View testID={testID} style={{ gap: space.sm, paddingBottom: space.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <Text variant="caption" color="ink2">
          Finger pain today
        </Text>
        <Button
          label="Skip"
          variant="quiet"
          onPress={() => {
            onSkip();
            setOpen(false);
          }}
        />
      </View>

      <ChipRow
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          onAnswer(next);
          setOpen(false);
        }}
        splitAfter={6}
        groupLabel="Finger pain today, 0 to 10"
      />
      <Hairline />
    </View>
  );
}
