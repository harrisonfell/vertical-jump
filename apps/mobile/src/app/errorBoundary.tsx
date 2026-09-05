import { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, Screen, Text, space } from '@/ui';

/**
 * The last line before a white screen.
 *
 * It catches a render error and says the one thing the athlete actually needs
 * to know: the sets they logged are still here. Reload remounts the subtree and
 * nothing else. It never clears the database, never drains the sync queue, and
 * never signs anyone out, because a render bug is not a reason to lose work.
 */

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
  /** Bumped on Reload so the children below remount from scratch. */
  readonly attempt: number;
}

export const ERROR_BOUNDARY_COPY =
  'Something went wrong on this screen. Your logged sets are saved on this phone.';

function ErrorFallback({ onReload }: { readonly onReload: () => void }) {
  return (
    <Screen testID="error-boundary">
      <View style={{ gap: space.lg, paddingTop: space.xl }}>
        <Text variant="headline">Something went wrong</Text>
        <Text variant="body" color="ink2" style={{ maxWidth: 480 }}>
          {ERROR_BOUNDARY_COPY}
        </Text>
        <Button label="Reload" variant="primary" onPress={onReload} />
      </View>
    </Screen>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  private readonly reload = (): void => {
    this.setState((previous) => ({ failed: false, attempt: previous.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.failed) return <ErrorFallback onReload={this.reload} />;
    return (
      <View key={this.state.attempt} style={{ flex: 1 }}>
        {this.props.children}
      </View>
    );
  }
}
