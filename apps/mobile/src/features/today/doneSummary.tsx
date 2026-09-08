import { View } from 'react-native';
import { formatInteger } from '@vert/engine/units';
import { AppHeader, SyncLine } from '@/app';
import { useSessionWorkoutLink, useUnfinishSession, useWhoopConnection } from '@/data';
import { Button, ButtonRow, Screen, Text, space } from '@/ui';
import { countContacts, plannedSets } from './footer';
import { doneSummaryLine, notFinishedLine, sessionMinutes, whoopWaitLine } from './finish';
import { headerDate, headerTitle } from './header';
import { flattenExercises } from './model';
import type { TodayData } from './useTodayData';
import { WhoopStrip } from './whoopStrip';

/**
 * A session that is over.
 *
 * Static, factual, and quiet: what was done, how long it took, and the one
 * thing still outstanding, which is the Whoop workout that has not arrived
 * yet. Sets stay editable for a week, so the summary is a door back into the
 * runner rather than a lock on it.
 */

export interface DoneSummaryProps {
  readonly data: TodayData;
  readonly onEdit: () => void;
}

export function DoneSummary({ data, onEdit }: DoneSummaryProps) {
  const unfinish = useUnfinishSession();
  const { session, plan, week } = data;
  const connection = useWhoopConnection();
  const workoutLink = useSessionWorkoutLink(session?.id);
  if (session === null || plan === null) return null;

  const whoopLine = whoopWaitLine({
    connectionStatus: connection.data?.status ?? null,
    workoutLinked: (workoutLink.data ?? null) !== null,
  });

  const exercises = flattenExercises(plan);
  const tally = countContacts(exercises, data.repsByExercise);
  const tonnageKg = data.logs.reduce(
    (total, log) => total + (log.repsDone ?? 0) * (log.loadKg ?? 0),
    0,
  );
  const planned = plannedSets(plan);
  const finished = session.status === 'done';

  // Only what the sentence above does not already carry. A finished session
  // names its sets, minutes, contacts, tonnage and RPE there, so the capped
  // count and the legs answer are all that is left; an open session has none
  // of it yet and gets what it has.
  const facts = finished
    ? [
        ...(tally.highIntensity === 0
          ? []
          : [`high-intensity contacts ${formatInteger(tally.highIntensity)}`]),
        `legs ${session.legsFeel ?? 'not recorded'}`,
      ]
    : [
        ...(tally.total === 0 ? [] : [`contacts ${formatInteger(tally.total)}`]),
        ...(tally.highIntensity === 0
          ? []
          : [`high-intensity ${formatInteger(tally.highIntensity)}`]),
        ...(session.rpe === null ? [] : [`RPE ${session.rpe}`]),
        ...(session.legsFeel === null ? [] : [`legs ${session.legsFeel}`]),
      ];

  return (
    <Screen
      header={
        <AppHeader
          title={headerTitle({
            w: week?.w ?? 1,
            W: data.totalWeeks,
            blockType: data.blockType,
            dayType: session.dayType,
            suffixes: plan.headerSuffixes,
          })}
          trailingText={headerDate(session.scheduledDate)}
        />
      }
      testID="today-done"
    >
      <SyncLine />
      <WhoopStrip today={data.today} />

      <View style={{ gap: space.sm }}>
        {finished ? (
          <Text variant="label" color="ink2">
            Session complete
          </Text>
        ) : null}
        <Text variant="body" color="ink" numeric>
          {finished
            ? doneSummaryLine({
                setsLogged: data.logs.length,
                setsPlanned: planned,
                minutes: sessionMinutes(session.startedAt, session.markedCompleteAt),
                contacts: tally.total,
                tonnageKg,
                sessionRpe: session.rpe,
              })
            : notFinishedLine(data.logs.length, planned, false, week?.w ?? 1)}
        </Text>
        {facts.length === 0 ? null : (
          <Text variant="caption" color="ink2" numeric>
            {facts.join(' · ')}
          </Text>
        )}
        {whoopLine === null ? null : (
          <Text variant="caption" color="ink3">
            {whoopLine}
          </Text>
        )}
      </View>

      <ButtonRow>
        <Button label="Edit sets" variant="secondary" onPress={onEdit} testID="edit-sets" />
        {finished ? (
          <Button
            label="Reopen session"
            variant="quiet"
            onPress={() => unfinish.mutate(session.id)}
          />
        ) : null}
      </ButtonRow>

      <Text variant="caption" color="ink3">
        Sets stay editable for 7 days. Notes and RPE never expire.
      </Text>
    </Screen>
  );
}
