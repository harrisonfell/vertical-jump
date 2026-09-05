import { View } from 'react-native';
import { Text } from '../text';
import { space } from '../theme';
import { Button } from './button';

export interface EmptyStateProps {
  /**
   * One paragraph that teaches the surface: "No tests yet. First test: Sat 13
   * Sep." Never "Nothing here", never an illustration.
   */
  readonly body: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly testID?: string;
}

/** One paragraph and one action. That is the whole empty state. */
export function EmptyState({ body, actionLabel, onAction, testID }: EmptyStateProps) {
  return (
    <View testID={testID} style={{ gap: space.lg, paddingVertical: space.lg, maxWidth: 560 }}>
      <Text variant="body" color="ink2">
        {body}
      </Text>
      <Button label={actionLabel} variant="primary" onPress={onAction} />
    </View>
  );
}
