import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { href, serverConfigured, serverUrl } from '@/app';
import { Button, Field, Screen, Text, space } from '@/ui';
import { SETUP_COPY, lockoutLine } from './copy';
import { StepFrame } from './parts';
import {
  attemptMessage,
  isSixDigits,
  lockoutRemaining,
  submitCredential,
  LOCKOUT_AFTER,
  LOCKOUT_SECONDS,
  type AttemptOutcome,
} from './pairing';

/**
 * /pair on the phone and /login on the web.
 *
 * v1 ships without a review server, so the honest state is the whole screen:
 * there is nothing to pair with, and everything the athlete logs stays on the
 * phone. With a server configured, the phone takes the one-time code shown on
 * the web review and the web takes the owner's passphrase.
 */

export interface PairScreenProps {
  readonly mode: 'pair' | 'login';
}

export function PairScreen({ mode }: PairScreenProps) {
  const router = useRouter();
  const configured = serverConfigured();
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<AttemptOutcome>('none');
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  // The wait is a timestamp, not a flag, so it can end. The interval runs only
  // while one is running and clears the failure count when it does end: after
  // 60 s the athlete gets the form back, which is what the copy promises.
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = (): void => {
      const left = lockoutRemaining(lockedUntil, Date.now());
      setRemaining(left);
      if (left > 0) return;
      setLockedUntil(null);
      setFailures(0);
      setOutcome('none');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const locked = lockedUntil !== null;

  const message = attemptMessage({ outcome, failures }, mode, {
    invalidCode: SETUP_COPY.pairCodeInvalid,
    wrongCode: SETUP_COPY.pairCodeWrong,
    wrongPassphrase: SETUP_COPY.loginWrong,
    locked: lockoutLine(remaining),
    unreachable: SETUP_COPY.pairUnreachable,
  });

  const submit = async (): Promise<void> => {
    const base = serverUrl();
    if (base === null || locked) return;
    if (mode === 'pair' && !isSixDigits(value)) {
      setOutcome('invalid');
      return;
    }
    setBusy(true);
    try {
      const result = await submitCredential(mode, value);
      if (result.ok) {
        setOutcome('none');
        setDone(true);
        return;
      }
      if (result.outcome !== 'wrong') {
        setOutcome(result.outcome);
        return;
      }
      // The server counts the failures that matter, so when it names a wait we
      // count its seconds down rather than starting a fresh 60 s of our own.
      const next = result.lockedForS === null ? failures + 1 : LOCKOUT_AFTER;
      setFailures(next);
      setOutcome('wrong');
      if (result.lockedForS !== null) {
        setLockedUntil(Date.now() + result.lockedForS * 1000);
      } else if (next >= LOCKOUT_AFTER) {
        setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
      }
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'pair' ? SETUP_COPY.pairTitle : SETUP_COPY.loginTitle;

  if (!configured) {
    return (
      <Screen testID={`${mode}-no-server`}>
        <StepFrame title={title} lead={SETUP_COPY.pairNoServer}>
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={SETUP_COPY.pairPrivacyLink}
              variant="secondary"
              onPress={() => router.push(href('/privacy'))}
              testID="pair-privacy"
            />
          </View>
        </StepFrame>
      </Screen>
    );
  }

  return (
    <Screen testID={mode}>
      <StepFrame
        title={title}
        lead={
          mode === 'pair'
            ? 'Enter the code shown on the web review.'
            : 'One owner, one passphrase. There are no accounts.'
        }
      >
        <View style={{ gap: space.lg }}>
          {done ? (
            <Text variant="body" color="ink" accessibilityLiveRegion="polite">
              {SETUP_COPY.pairDone}
            </Text>
          ) : (
            <>
              <Field
                label={mode === 'pair' ? SETUP_COPY.pairCodeLabel : SETUP_COPY.loginPassphraseLabel}
                value={value}
                onChangeText={(text) => {
                  setValue(text);
                  // Editing drops a stale attempt error, but never the wait.
                  if (!locked && outcome !== 'none') setOutcome('none');
                }}
                numeric={mode === 'pair'}
                // The passphrase is masked and handed to the platform's password
                // manager; the six-digit pairing code is read off a screen in the
                // room and stays visible so it can be checked against it.
                secure={mode === 'login'}
                onSubmit={() => void submit()}
                {...(mode === 'pair' ? { maxLength: 6 } : null)}
                testID={`${mode}-input`}
                {...(message === null
                  ? {
                      helper:
                        mode === 'pair'
                          ? SETUP_COPY.pairCodeHelper
                          : SETUP_COPY.loginPassphraseHelper,
                    }
                  : { error: message })}
              />
              <Button
                label={
                  locked
                    ? lockoutLine(remaining)
                    : mode === 'pair'
                      ? SETUP_COPY.pairSubmit
                      : SETUP_COPY.loginSubmit
                }
                onPress={() => void submit()}
                fullWidth
                loading={busy}
                disabled={locked}
                testID={`${mode}-submit`}
              />
            </>
          )}

          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={SETUP_COPY.pairPrivacyLink}
              variant="quiet"
              onPress={() => router.push(href('/privacy'))}
            />
          </View>
        </View>
      </StepFrame>
    </Screen>
  );
}
