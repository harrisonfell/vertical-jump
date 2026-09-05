import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { href } from '@/app';
import { usePatchSession } from '@/data';
import { Button, ButtonRow, Notice, space } from '@/ui';
import {
  REENTRY_LINE,
  missedLine,
  needsReentry,
  reassessmentDue,
  reassessmentRow,
  reentryTitle,
  restrictedNotice,
} from './cards';
import type { TodayData } from './useTodayData';

/**
 * The cards that sit between the soreness row and the first block.
 *
 * Each is a fact with an action beside it and nothing else: a missed session
 * can be logged or dismissed, a long break offers the re-entry week, a pain
 * reassessment asks its question. None of them nags, and the calendar never
 * shifts underneath them.
 */

export function TodayCards({ data }: { readonly data: TodayData }) {
  const router = useRouter();
  const patch = usePatchSession();

  const missed = data.forced === 'missed' || data.missedSession !== null ? data.missedSession : null;
  const reentry =
    data.forced === 'reentry' || needsReentry(data.lastCompletedDate, data.today);
  const reassess = data.painStatus.find(
    (entry) =>
      entry.clearedAt === null &&
      (data.forced === 'reassess' || reassessmentDue(entry.reassessDueAt, data.today)),
  );

  const restricted = data.restricted;

  return (
    <View style={{ gap: space.md }}>
      {restricted && data.restrictedPain !== null ? (
        <Notice
          text={restrictedNotice(data.restrictedPain.location)}
          detail="Update pain status when it eases."
          actionLabel="Update pain status"
          onAction={() => router.push(href('/clearance'))}
          testID="today-restricted"
        />
      ) : null}

      {reassess === undefined ? null : (
        <Notice
          text={reassessmentRow(reassess.location)}
          detail="Moderate treatment continues until you answer. The check is in Settings, under Pain."
          actionLabel="Open settings"
          onAction={() => router.push(href('/settings'))}
          testID="today-reassessment"
        />
      )}

      {missed === null ? null : (
        <View style={{ gap: space.sm }}>
          <Notice
            text={missedLine(missed.scheduledDate, missed.dayType)}
            detail="The calendar does not shift. Log it on its own date, or let it stand."
            testID="today-missed"
          />
          <ButtonRow>
            <Button
              label="Log retroactively"
              variant="secondary"
              onPress={() => router.push(href(`/session/${missed.id}`))}
            />
            <Button
              label="Dismiss"
              variant="quiet"
              onPress={() =>
                patch.mutate({ sessionId: missed.id, patch: { dismissed: true } })
              }
            />
          </ButtonRow>
        </View>
      )}

      {reentry && data.lastCompletedDate !== null ? (
        <Notice
          text={reentryTitle(data.lastCompletedDate, data.today)}
          detail={REENTRY_LINE}
          testID="today-reentry"
        />
      ) : null}
    </View>
  );
}
