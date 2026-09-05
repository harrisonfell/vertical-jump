import { useRouter } from 'expo-router';
import { useWhoopConnection, useWhoopStrip } from '@/data';
import { href } from '@/app';
import { Strip } from '@/ui';
import { stripModel } from './strip';

/**
 * The Whoop strip, on screen.
 *
 * The model beside it decides what the row may claim; this file only renders
 * it and sends a tap to the Whoop settings screen.
 */

export function WhoopStrip({ today }: { readonly today: string }) {
  const router = useRouter();
  const connection = useWhoopConnection();
  const day = useWhoopStrip(today);

  const model = stripModel({
    connectionStatus: connection.data?.status ?? null,
    backfillDaysDone: connection.data?.backfillDaysDone ?? 0,
    backfillDaysTotal: connection.data?.backfillDaysTotal ?? 0,
    lastSyncAt: connection.data?.lastSyncAt ?? day.data?.lastSyncAt ?? null,
    recoveryScore: day.data?.recoveryScore ?? null,
    recoveryState: day.data?.recoveryState ?? 'missing',
    sleepPerformance: day.data?.sleepPerformance ?? null,
    sleepHours: day.data?.sleepHours ?? null,
    sleepState: day.data?.sleepState ?? 'missing',
    strainToday: day.data?.strainToday ?? null,
    strainYesterday: day.data?.strainYesterday ?? null,
    strainState: day.data?.strainState ?? 'missing',
    today,
  });

  return (
    <Strip
      testID="today-whoop-strip"
      state={model.state}
      slots={model.slots}
      {...(model.syncedAt === undefined ? null : { syncedAt: model.syncedAt })}
      {...(model.staleDays === undefined ? null : { staleDays: model.staleDays })}
      {...(model.importedDays === undefined ? null : { importedDays: model.importedDays })}
      {...(model.importTotalDays === undefined ? null : { importTotalDays: model.importTotalDays })}
      onAction={() => router.push(href('/settings/whoop'))}
    />
  );
}
