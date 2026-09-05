import { useState } from 'react';
import { View } from 'react-native';
import { Button, ChipRow, Hairline, Text, space, type ChipOption } from '@/ui';

/**
 * "Soreness today", asked before the first set and answerable afterwards.
 *
 * Eleven chips would run off a 390 px screen, so 0 to 5 sits on one line and
 * 6 to 10 on the next, each a 44 px target beside a 44 px Skip. The answer is
 * a fact the program acts on, so it can always be changed; there is no
 * confirmation and no override, because 7 or higher is not a negotiation.
 */

/** 0 to 10, broken after 6 so the row reads the way the question is asked. */
const OPTIONS: readonly ChipOption<number>[] = Array.from({ length: 11 }, (_v, value) => ({
  value,
  label: String(value),
}));

export interface SorenessRowProps {
  readonly value: number | null;
  /** True once the athlete has skipped: the row stays quiet until reopened. */
  readonly skipped?: boolean;
  readonly onAnswer: (value: number) => void;
  readonly onSkip: () => void;
  readonly testID?: string;
}

export function SorenessRow({
  value,
  skipped = false,
  onAnswer,
  onSkip,
  testID,
}: SorenessRowProps) {
  const answered = value !== null;
  const [open, setOpen] = useState(!answered && !skipped);

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
            {answered ? `Soreness today ${value}/10` : 'Soreness today: skipped'}
          </Text>
          <Button label="Change" variant="quiet" onPress={() => setOpen(true)} />
        </View>
        <Hairline />
      </View>
    );
  }

  const answer = (next: number): void => {
    onAnswer(next);
    setOpen(false);
  };

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
          Soreness today
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
        onChange={answer}
        splitAfter={6}
        groupLabel="Soreness today, 0 to 10"
      />
      <Hairline />
    </View>
  );
}
