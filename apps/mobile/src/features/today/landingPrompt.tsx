import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Landing } from '@/data';
import { Button, LANDING_PROMPT_SECONDS, Text, space } from '@/ui';

/**
 * "How did that land?" on the last set of a height ladder.
 *
 * Three answers, five seconds, and Good if nobody says otherwise, because the
 * athlete has just landed off a box and is not holding the phone. A Poor
 * landing holds the ladder rung, which is the only reason the question is
 * worth asking at all. The count is static text, once a second, so reduced
 * motion needs no separate path.
 */

const OPTIONS: readonly { readonly value: Landing; readonly label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'ok', label: 'OK' },
  { value: 'poor', label: 'Poor' },
];

export interface LandingPromptProps {
  readonly onAnswer: (landing: Landing) => void;
  readonly seconds?: number;
  readonly testID?: string;
}

export function LandingPrompt({
  onAnswer,
  seconds = LANDING_PROMPT_SECONDS,
  testID,
}: LandingPromptProps) {
  const [left, setLeft] = useState(seconds);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (answered) return;
    if (left <= 0) {
      setAnswered(true);
      onAnswer('good');
      return;
    }
    const id = setTimeout(() => setLeft((current) => current - 1), 1000);
    return () => clearTimeout(id);
  }, [answered, left, onAnswer]);

  if (answered) return null;

  const answer = (landing: Landing): void => {
    setAnswered(true);
    onAnswer(landing);
  };

  return (
    <View testID={testID} style={{ gap: space.sm, paddingBottom: space.md }}>
      <Text variant="caption" color="ink2" numeric accessibilityLiveRegion="polite">
        {`How did that land? Good in ${left} s`}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            variant="secondary"
            onPress={() => answer(option.value)}
            style={{ flex: 1 }}
          />
        ))}
      </View>
    </View>
  );
}
