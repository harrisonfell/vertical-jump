import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { AppHeader, SyncLine, href } from '@/app';
import { useMoveSession } from '@/data';
import { Button, ButtonRow, EmptyState, Notice, Screen, Sheet, Text, space, useSheet } from '@/ui';
import { headerDate, restDayTitle } from './header';
import { moveDecision, plannedMinutes, NOTHING_TO_MOVE } from './move';
import { JumpTestBlock } from './jumpTestBlock';
import type { TodayData } from './useTodayData';
import { WhoopStrip } from './whoopStrip';

/**
 * The day with no session on it.
 *
 * Rest is prescribed, so the screen is not empty and does not apologise. It
 * says what tomorrow is, offers to pull the next session forward when the
 * spacing rules allow, and refuses in plain words when they do not. The rule
 * number lives in the Plan summary, never here.
 */

export function RestDay({ data }: { readonly data: TodayData }) {
  const router = useRouter();
  const test = useSheet();
  const move = useMoveSession();
  const [refusal, setRefusal] = useState<string | null>(null);

  const next = data.nextSession;
  const decision = moveDecision(data.week?.snapshot, next?.scheduledDate ?? null, data.today);
  const moveHere = (): void => {
    if (!decision.ok || next === null) {
      setRefusal(decision.ok ? NOTHING_TO_MOVE : decision.reason);
      return;
    }
    setRefusal(null);
    move.mutate(
      { sessionId: next.id, toDate: data.today },
      {
        onError: () =>
          setRefusal('That move did not save. Check your connection, then try again.'),
      },
    );
  };

  const tomorrow =
    next === null
      ? 'Nothing else is scheduled this week.'
      : `Next: ${next.dayType} on ${headerDate(next.scheduledDate)}`;

  return (
    <Screen
      header={
        <AppHeader
          title={restDayTitle(data.week?.w ?? 1)}
          trailingText={headerDate(data.today)}
          subtitle={tomorrow}
        />
      }
      testID="today-rest"
    >
      <SyncLine />
      <WhoopStrip today={data.today} />

      {data.program === null ? (
        <EmptyState
          body="No program yet. Answer five questions and it builds from your own numbers."
          actionLabel="Build program"
          onAction={() => router.push(href('/setup/one'))}
        />
      ) : null}

      {refusal === null ? null : <Notice text={refusal} live testID="today-move-refused" />}

      <View style={{ gap: space.md }}>
        <Text variant="body" color="ink2">
          Rest is prescribed. It is what makes the next session count.
        </Text>
        <ButtonRow>
          <Button
            label="Train today anyway"
            variant="secondary"
            disabled={next === null || move.isPending}
            loading={move.isPending}
            onPress={moveHere}
            testID="train-today"
          />
          <Button label="Log a jump test" variant="quiet" onPress={test.show} />
        </ButtonRow>
        {decision.ok && next !== null ? (
          <Text variant="caption" color="ink3">
            {[next.dayType, plannedMinutes(next.snapshot)]
              .filter((part) => part !== undefined)
              .join(' · ')}
          </Text>
        ) : null}
      </View>

      <Sheet visible={test.open} onClose={test.hide} title="Log jump test">
        <JumpTestBlock
          today={data.today}
          sessionId={null}
          bodyweightKg={data.athlete?.bodyweightKg ?? null}
          eyebrow={`Jump test · ${headerDate(data.today)}`}
        />
      </Sheet>
    </Screen>
  );
}
