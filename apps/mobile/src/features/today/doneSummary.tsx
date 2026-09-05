import { View } from 'react-native';
import { AppHeader, SyncLine } from '@/app';
import { useSessionWorkoutLink, useUnfinishSession, useWhoopConnection } from '@/data';
import { Button, ButtonRow, Screen, Table, Text, space } from '@/ui';
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

  const rows: readonly { readonly name: string; readonly value: string }[] = [
    { name: 'Sets', value: `${data.logs.length} of ${planned}` },
    { name: 'Contacts', value: String(tally.total) },
    { name: 'High-intensity contacts', value: String(tally.highIntensity) },
    { name: 'Session RPE', value: session.rpe === null ? 'not recorded' : String(session.rpe) },
    { name: 'Legs', value: session.legsFeel ?? 'not recorded' },
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
        <Text variant="label" color="ink2">
          {finished ? 'Session complete' : 'Session open'}
        </Text>
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
        {whoopLine === null ? null : (
          <Text variant="caption" color="ink3">
            {whoopLine}
          </Text>
        )}
      </View>

      <Table
        caption="Session summary"
        columns={[
          { key: 'name', header: 'Measure', render: (row) => row.name },
          { key: 'value', header: 'Value', numeric: true, render: (row) => row.value },
        ]}
        rows={rows}
        rowKey={(row) => row.name}
      />

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
