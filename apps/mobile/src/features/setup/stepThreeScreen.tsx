import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { href, serverConfigured } from '@/app';
import { createWhoopClient } from '@/features/whoop/client';
import { Button, Notice, Screen, Text, space } from '@/ui';
import { SETUP_COPY } from './copy';
import { StepFrame } from './parts';

/**
 * Step 3: connect Whoop, or skip.
 *
 * The app never holds a Whoop token. It opens the server's start URL in the
 * system authentication session; Whoop redirects to the server's https
 * callback, the server exchanges the code and bounces back to the app's own
 * scheme. With no server configured there is nothing to open, so the screen
 * says so plainly and offers the skip.
 */

type Status = 'idle' | 'opening' | 'cancelled' | 'failed';

export function StepThreeScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const configured = serverConfigured();

  const next = (): void => {
    router.replace(href('/setup/build'));
  };

  const connect = async (): Promise<void> => {
    if (!configured) return;
    setStatus('opening');
    // Back to this step, not to the app's default landing scheme: setup is a
    // sequence and the athlete should return to the card they left.
    const redirect = Linking.createURL('/setup/three');
    try {
      const result = await createWhoopClient().connect(redirect);
      if (result.outcome === 'cancelled') {
        setStatus('cancelled');
        return;
      }
      // The web navigated away; the server brings the page back on its own.
      if (result.outcome === 'redirected') return;
      next();
    } catch {
      setStatus('failed');
    }
  };

  return (
    <Screen testID="setup-three">
      <StepFrame step={3} title={SETUP_COPY.stepThreeTitle} lead={SETUP_COPY.stepThreeLead}>
        <View style={{ gap: space.lg }}>
          {configured ? null : <Notice text={SETUP_COPY.stepThreeNoServer} testID="whoop-no-server" />}

          {status === 'cancelled' ? (
            <Notice text={SETUP_COPY.stepThreeCancelled} live testID="whoop-cancelled" />
          ) : null}
          {status === 'failed' ? (
            <Notice
              text={SETUP_COPY.stepThreeFailed}
              actionLabel="Retry"
              onAction={() => void connect()}
              live
              testID="whoop-failed"
            />
          ) : null}

          {configured ? (
            <Button
              label={SETUP_COPY.stepThreeConnect}
              onPress={() => void connect()}
              fullWidth
              loading={status === 'opening'}
              testID="whoop-connect"
            />
          ) : null}

          <Button
            label={SETUP_COPY.stepThreeSkip}
            variant={configured ? 'secondary' : 'primary'}
            onPress={next}
            fullWidth
            testID="whoop-skip"
          />

          <Text variant="caption" color="ink3">
            {SETUP_COPY.stepThreeAttribution}
          </Text>
        </View>
      </StepFrame>
    </Screen>
  );
}
