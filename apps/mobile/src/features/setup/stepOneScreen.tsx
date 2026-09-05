import { useRouter } from 'expo-router';
import { href } from '@/app';
// A deep import on purpose: the app barrel pulls the whole shell in behind it,
// and this screen wants one hook out of it.
import { useOwnerPrefill } from '@/app/ownerPrefill';
import { useAthlete, usePainStatus, useDbReady } from '@/data';
import { Screen, Skeleton } from '@/ui';
import { climbingAnswersFrom } from './climbing';
import { severityRawFrom, trainingAgeFromYears } from './engineAthlete';
import { useSetupPrefill } from '@/state/setupPrefill';
import { OWNER_STEP_ONE } from './ownerPrefill';
import { useSaveStepOne } from './saveStepOne';
import { SetupStepOne, type StepOneValues } from './stepOne';
import type { PainLocationValue, SportValue } from './questions';

/**
 * Step 1 as a route: it loads what is on file, hands it to the form, and turns
 * the save into a routing decision. Leaving step 1 evaluates the pain gate; a
 * 5+ anywhere goes to the clearance screen with its per-location sentence.
 *
 * The form seeds its state once, so nothing is drawn until the row it fills
 * from has arrived, the owner's boot write included. Opening on an unread row
 * would leave the answers blank for good.
 */

const SPORTS: readonly SportValue[] = [
  'basketball',
  'speed_climbing',
  'football',
  'soccer',
  'track_field',
  'volleyball',
  'baseball',
  'none',
];

const LOCATIONS: readonly PainLocationValue[] = [
  'knee',
  'achilles_calf',
  'shin',
  'hamstring',
  'hip',
  'back',
  'shoulder',
  'finger',
  'other',
];

function daysOrNull(value: number | null): 2 | 3 | 4 | 5 | undefined {
  return value === 2 || value === 3 || value === 4 || value === 5 ? value : undefined;
}

/** The stored 1 to 10 number, back as the chip the athlete tapped. */
function severityChip(raw: number): 1 | 3 | 5 {
  const answer = severityRawFrom(raw);
  if (answer === '5+') return 5;
  if (answer === '3-4') return 3;
  return 1;
}

export function StepOneScreen() {
  const router = useRouter();
  const { ready } = useDbReady();
  const prefill = useOwnerPrefill();
  const athlete = useAthlete();
  const pains = usePainStatus();
  const save = useSaveStepOne();
  const ownerRequested = useSetupPrefill((state) => state.ownerRequested);

  if (!ready || !prefill.settled || athlete.isPending || pains.isPending) {
    return (
      <Screen testID="setup-one-loading">
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="line" count={10} />
      </Screen>
    );
  }

  const row = athlete.data;
  const openPain = pains.data?.[0];

  const stored: Partial<StepOneValues> = {
    ...climbingAnswersFrom(row),
    sport: SPORTS.find((sport) => sport === row?.sport),
    trainingAge:
      row?.trainingAgeYears == null ? undefined : trainingAgeFromYears(row.trainingAgeYears),
    daysPerWeek: daysOrNull(row?.daysPerWeek ?? null),
    hasPain: openPain !== undefined,
    painLocation: LOCATIONS.find((entry) => entry === openPain?.location) ?? null,
    painSeverity: openPain === undefined ? null : severityChip(openPain.severityRaw),
    painDuration: openPain?.onset ?? null,
  };

  // "Use my saved profile" fills the form and nothing else: the answers sit
  // here until the athlete saves them, exactly as if they had tapped them in.
  const initial: Partial<StepOneValues> = ownerRequested ? OWNER_STEP_ONE : stored;

  const submit = (values: StepOneValues): void => {
    save.mutate(values, {
      onSuccess: (result) => {
        router.replace(href(result.clearance === null ? '/setup/two' : '/clearance'));
      },
    });
  };

  return (
    <Screen testID="setup-one">
      <SetupStepOne
        initial={initial}
        onSave={submit}
        saving={save.isPending}
        {...(save.isError ? { error: "Couldn't save. Check your connection." } : null)}
      />
    </Screen>
  );
}
