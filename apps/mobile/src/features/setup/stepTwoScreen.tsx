import { useRouter } from 'expo-router';
import { href } from '@/app';
// A deep import on purpose: the app barrel pulls the whole shell in behind it,
// and this screen wants one hook out of it.
import { useOwnerPrefill } from '@/app/ownerPrefill';
import { useAthlete, useDbReady, usePainStatus, useToday } from '@/data';
import { Screen, Skeleton } from '@/ui';
import { useSetupPrefill } from '@/state/setupPrefill';
import { useSaveStepTwo } from './saveStepTwo';
import { SetupStepTwo, type StepTwoValues } from './stepTwo';
import { stepTwoInitial } from './stepTwoInitial';
import { useBaselineTest } from './useBaseline';

/**
 * Step 2 as a route. It fills the form from what is on file, saves the
 * profile and the baseline test, then hands over to step 3.
 *
 * Nothing is drawn until the row it fills from has arrived, the owner's boot
 * write included. The form seeds its state once, so a screen that opens on an
 * unread row keeps the blanks it opened with: the skeleton is what keeps the
 * weekday chips and the start line honest.
 */
export function StepTwoScreen() {
  const router = useRouter();
  const today = useToday();
  const { ready } = useDbReady();
  const prefill = useOwnerPrefill();
  const athlete = useAthlete();
  const pains = usePainStatus();
  const baseline = useBaselineTest();
  const save = useSaveStepTwo();
  const ownerRequested = useSetupPrefill((state) => state.ownerRequested);
  const clearPrefill = useSetupPrefill((state) => state.clearOwnerPrefill);

  const initial = stepTwoInitial({
    athlete: athlete.data,
    baseline: baseline.data,
    pains: pains.data,
    today,
    ownerRequested,
    settled: ready && prefill.settled,
  });

  if (!initial.ready) {
    return (
      <Screen testID="setup-two-loading">
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="line" count={12} />
      </Screen>
    );
  }

  const submit = (values: StepTwoValues): void => {
    save.mutate(values, {
      onSuccess: () => {
        // The saved profile has landed in the store now, so the request that
        // put it in the form is spent.
        clearPrefill();
        router.replace(href('/setup/three'));
      },
    });
  };

  return (
    <Screen testID="setup-two">
      <SetupStepTwo
        initial={initial.values}
        today={today}
        onSave={submit}
        trainingAge={initial.trainingAge}
        sport={initial.sport}
        wallWork={initial.wallWork}
        lowerLimbPain={initial.lowerLimbPain}
        saving={save.isPending}
        {...(save.isError ? { error: save.error.message } : null)}
      />
    </Screen>
  );
}
