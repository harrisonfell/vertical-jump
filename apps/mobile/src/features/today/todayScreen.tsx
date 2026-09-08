import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, SyncLine, formatClock, href } from '@/app';
import { useWeeks } from '@/data';
import { EmptyState, Notice, Screen } from '@/ui';
import { DoneSummary } from './doneSummary';
import { RestDay } from './restDay';
import { SessionRunner } from './sessionRunner';
import { TodaySkeleton } from './todaySkeleton';
import { useAutoRevise } from './useAutoRevise';
import { useTodayData } from './useTodayData';

/**
 * Today.
 *
 * One screen with five shapes: the skeleton while the database opens, the
 * runner on a training day, the summary once it is finished, the rest-day view,
 * and the empty state before a program exists. The branch is decided here so
 * every other file in this feature can assume it has what it needs.
 */

export function TodayScreen() {
  const data = useTodayData();
  // Once a week has real outcomes, the weeks after it are rebuilt from them.
  // A no-op when there is nothing new to fold in, which is most mounts.
  useAutoRevise();
  const router = useRouter();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const weeks = useWeeks(data.program?.id);
  const nextWeek = useMemo(() => {
    const w = data.week?.w;
    if (w === undefined) return null;
    return (weeks.data ?? []).find((entry) => entry.w === w + 1) ?? null;
  }, [data.week?.w, weeks.data]);

  if (data.forced === 'loading' || data.status === 'loading') return <TodaySkeleton />;

  if (data.forced === 'error' || (data.status === 'error' && data.session === null)) {
    return (
      <LoadError
        message={data.error?.message ?? null}
        cachedAt={data.cachedAt}
        onRetry={() => void client.invalidateQueries()}
      />
    );
  }

  if (data.program === null) {
    return (
      <Screen header={<AppHeader title="Today" variant="headline" />} testID="today-no-program">
        <SyncLine />
        <EmptyState
          body="No program yet: the whole block is built from five answers and your jump numbers."
          actionLabel="Build program"
          onAction={() => router.push(href('/setup/one'))}
        />
      </Screen>
    );
  }

  if (data.forced === 'rest' || data.session === null) return <RestDay data={data} />;

  const done =
    data.session.status === 'done' || data.forced === 'done' || data.forced === 'notFinished';
  if (done && !editing && !finishing) {
    return <DoneSummary data={data} onEdit={() => setEditing(true)} />;
  }

  return <SessionRunner data={data} nextWeek={nextWeek} onFinishSheet={setFinishing} />;
}

/**
 * The cached rendering path.
 *
 * One line, and the only part of it the owner can act on is how old the numbers
 * are: a saved copy with no timestamp is a copy they cannot judge. One Retry,
 * because two identical controls in one small view is a stutter, not a choice.
 */
function LoadError({
  message,
  cachedAt,
  onRetry,
}: {
  readonly message: string | null;
  readonly cachedAt: string | null;
  readonly onRetry: () => void;
}) {
  const clock = cachedAt === null ? null : formatClock(cachedAt);
  return (
    <Screen header={<AppHeader title="Today" variant="headline" />} testID="today-error">
      <Notice
        text={clock === null ? 'Today did not load.' : `Showing saved copy from ${clock}`}
        {...(message === null ? null : { detail: message })}
        actionLabel="Retry"
        onAction={onRetry}
        live
      />
    </Screen>
  );
}
