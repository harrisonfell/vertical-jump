import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { addDays, canMoveSession, loadRuleset, weekIndexOf } from '@vert/engine';
import { AppHeader, routeHref } from '@/app';
import {
  useCurrentProgram,
  useFinishSession,
  useLinkWorkout,
  useLogSet,
  useMoveSession,
  useReadinessOutcome,
  useSession,
  useSessionExercises,
  useSessionWorkoutLink,
  useSessionsForDay,
  useSetLogs,
  useUndoSet,
  useUnlinkWorkout,
  useWeeks,
  useWhoopConnection,
  useWhoopWorkout,
  useWhoopWorkoutsBetween,
} from '@/data/hooks';
import { useToday } from '@/data/db';
import { Button, EmptyState, Screen, Skeleton, Text, space, useSheet } from '@/ui';
import {
  dayTypeLabel,
  formatDayDate,
  isProjectedWeek,
  readPrescriptions,
  readSessionPlan,
  readSkeleton,
  readWeekPlan,
} from '@/features/plan';
import { useFingerPainOn } from './answers';
import { hasHardFingerWork, rowNotes } from './planNotes';
import {
  finishedAfterBuildLine,
  matchWindow,
  notFinishedLine,
  nextWeekIsFinal,
  sessionView,
} from './detail';
import { FutureView } from './futureView';
import { PastView } from './pastView';
import { RetroView } from './retroView';
import { readSessionStates } from './states';
import { WhoopMatch } from './whoopMatch';

/**
 * One session, in the past or the future. Today redirects to the runner,
 * because there is exactly one place a session is performed.
 */

/**
 * How far back a missed session can still be logged. The same window the
 * missed-session card on Today offers, so the card never routes to a screen
 * that refuses (defect H-10).
 */
const RETRO_WINDOW_DAYS = 10;

function SessionSkeletonView() {
  return (
    <Screen header={<AppHeader title="Session" variant="headline" />}>
      <Skeleton skeletonFor="line" count={2} />
      <Skeleton skeletonFor="setRow" count={8} />
    </Screen>
  );
}

export interface SessionScreenProps {
  readonly sessionId: string;
}

export function SessionScreen({ sessionId }: SessionScreenProps) {
  const router = useRouter();
  const today = useToday();
  const params = useLocalSearchParams<{ state?: string }>();
  const states = useMemo(() => readSessionStates(params.state), [params.state]);
  const [retro, setRetro] = useState(false);
  const matchSheet = useSheet();

  const session = useSession(sessionId);
  const exercises = useSessionExercises(sessionId);
  const logs = useSetLogs(sessionId);
  const program = useCurrentProgram();
  const weeks = useWeeks(program.data?.id);
  const todaySessions = useSessionsForDay();
  const link = useSessionWorkoutLink(sessionId);
  const workout = useWhoopWorkout(session.data?.whoopWorkoutId ?? null);
  const connection = useWhoopConnection();
  const readiness = useReadinessOutcome(sessionId);
  const fingerPain = useFingerPainOn(session.data?.scheduledDate ?? null);

  const finish = useFinishSession();
  const move = useMoveSession();
  const logSet = useLogSet();
  const undoSet = useUndoSet();
  const linkWorkout = useLinkWorkout();
  const unlinkWorkout = useUnlinkWorkout();

  const row = session.data ?? null;
  const window = useMemo(
    () =>
      row === null
        ? null
        : matchWindow(row.scheduledDate, row.startedAt, row.markedCompleteAt),
    [row],
  );
  const candidates = useWhoopWorkoutsBetween(window?.fromIso, window?.toIso);

  const ruleset = useMemo(() => loadRuleset(), []);
  const skeleton = useMemo(
    () => (program.data === null || program.data === undefined ? null : readSkeleton(program.data.snapshot)),
    [program.data],
  );

  const week = useMemo(() => {
    if (row === null) return null;
    return (
      weeks.data?.find(
        (entry) => entry.windowStart <= row.scheduledDate && row.scheduledDate <= entry.windowEnd,
      ) ?? null
    );
  }, [row, weeks.data]);

  const weekPlan = useMemo(() => (week === null ? null : readWeekPlan(week.snapshot)), [week]);
  const sessionPlan = useMemo(() => (row === null ? null : readSessionPlan(row.snapshot)), [row]);
  const notes = useMemo(() => rowNotes(sessionPlan), [sessionPlan]);

  if (states.has('loading') || session.isPending) return <SessionSkeletonView />;

  if (row === null) {
    return (
      <Screen header={<AppHeader title="Session" variant="headline" />}>
        <EmptyState
          body="That session is not in this program. It may belong to an earlier version, or it may have been removed when the program was rebuilt."
          actionLabel="Go to Plan"
          onAction={() => router.replace(routeHref('plan'))}
        />
      </Screen>
    );
  }

  const view = states.has('not-finished')
    ? 'not_finished'
    : states.has('future')
      ? 'future'
      : sessionView(row.scheduledDate, row.status, today);

  if (view === 'today') return <Redirect href={routeHref('today')} />;

  const totalWeeks = skeleton?.W ?? weeks.data?.length ?? 0;
  const weekNumber =
    week?.w ??
    (skeleton === null ? 0 : (weekIndexOf(skeleton.programStart, skeleton.W, row.scheduledDate) ?? 0));
  const nextWeekBuilt = states.has('built') || nextWeekIsFinal(weeks.data ?? [], weekNumber);

  // The stored day type is the rule book's template; the word the athlete
  // reads is the one the generator gave the day (`house.sc.upper_power_day`).
  const dayLabel = dayTypeLabel(row.dayType, sessionPlan?.sessionIntent === 'upper_power');

  const header = (
    <AppHeader
      title={`${formatDayDate(row.scheduledDate)} · ${dayLabel}`}
      variant="headline"
      {...(totalWeeks === 0 ? null : { subtitle: `Week ${weekNumber} of ${totalWeeks}` })}
    />
  );

  const whoop = (
    <WhoopMatch
      workout={workout.data ?? null}
      matchSource={link.data?.matchSource ?? null}
      connectionStatus={connection.data?.status ?? null}
      candidates={candidates.data ?? []}
      open={matchSheet.open}
      onOpen={matchSheet.show}
      onClose={matchSheet.hide}
      onPick={(workoutId) => {
        linkWorkout.mutate({ sessionId, whoopWorkoutId: workoutId, matchSource: 'manual', overlapS: 0 });
        matchSheet.hide();
      }}
      onClear={() => {
        unlinkWorkout.mutate(sessionId);
        matchSheet.hide();
      }}
    />
  );

  if (retro) {
    return (
      <Screen header={header}>
        <RetroView
          exercises={exercises.data ?? []}
          logs={logs.data ?? []}
          scheduledDateLabel={formatDayDate(row.scheduledDate)}
          onLogSet={(input) =>
            logSet.mutate({
              sessionId,
              sessionExerciseId: input.sessionExerciseId,
              setNumber: input.setNumber,
              repsDone: input.repsDone,
              loadKg: input.loadKg,
              durationS: input.durationS,
              plannedDate: row.scheduledDate,
              entrySource: 'typed',
            })
          }
          onUndoSet={(input) =>
            undoSet.mutate({
              sessionId,
              sessionExerciseId: input.sessionExerciseId,
              setNumber: input.setNumber,
            })
          }
          onFinish={() => {
            finish.mutate(sessionId);
            setRetro(false);
          }}
          onCancel={() => setRetro(false)}
          finishing={finish.isPending}
        />
      </Screen>
    );
  }

  if (view === 'future') {
    const rows = exercises.data ?? [];
    const main = rows.find((entry) => entry.block === 'main_lift') ?? null;
    const todayIsRest = (todaySessions.data ?? []).length === 0;
    const sameWeek =
      week !== null && week.windowStart <= today && today <= week.windowEnd;
    const decision =
      weekPlan === null || !todayIsRest || !sameWeek
        ? null
        : canMoveSession(weekPlan, row.scheduledDate, today, ruleset, today);

    return (
      <Screen header={header}>
        <FutureView
          dayType={dayLabel}
          mainLiftName={main?.exerciseName ?? null}
          workingSets={
            main === null
              ? null
              : readPrescriptions(main.perSet).filter((set) => !set.isRamp).length
          }
          weekNumber={weekNumber}
          hardFinger={hasHardFingerWork(sessionPlan)}
          exercises={rows}
          rowNotes={notes}
          projected={isProjectedWeek(week?.generatedBy ?? null)}
          move={
            decision === null
              ? null
              : decision.ok
                ? { ok: true, onMove: () => move.mutate({ sessionId, toDate: today }), pending: move.isPending }
                : { ok: false, reason: decision.reason }
          }
        />
      </Screen>
    );
  }

  if (view === 'missed') {
    const retroAllowed = row.scheduledDate >= addDays(today, -RETRO_WINDOW_DAYS);
    return (
      <Screen header={header}>
        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.xs }}>
            <Text variant="title" color="ink">
              Missed
            </Text>
            <Text variant="body" color="ink2" style={{ maxWidth: 560 }}>
              {retroAllowed
                ? 'Nothing was logged on this day. You can still log it: the sets keep the day they were prescribed for.'
                : `Nothing was logged on this day, and it is more than ${RETRO_WINDOW_DAYS} days behind. The calendar never shifts, so this one stays missed.`}
            </Text>
          </View>
          {retroAllowed ? (
            <Button label="Log retroactively" variant="primary" onPress={() => setRetro(true)} />
          ) : null}
        </View>
      </Screen>
    );
  }

  const notice =
    view === 'not_finished'
      ? nextWeekBuilt
        ? { text: finishedAfterBuildLine(weekNumber + 1) }
        : {
            text: notFinishedLine(row.loggedSetCount, row.prescribedSetCount),
            actionLabel: 'Finish session',
            onAction: () => finish.mutate(sessionId),
          }
      : undefined;

  return (
    <Screen header={header}>
      <PastView
        session={row}
        exercises={exercises.data ?? []}
        logs={logs.data ?? []}
        contacts={sessionPlan?.contacts ?? null}
        readinessLine={readiness.data?.line ?? sessionPlan?.readiness?.line ?? null}
        fingerPain={fingerPain.data?.value ?? null}
        rowNotes={notes}
        {...(notice === undefined ? null : { notice })}
      >
        {whoop}
      </PastView>
      {view === 'not_finished' && !nextWeekBuilt ? (
        <Button
          label="Finish session"
          variant="primary"
          size={56}
          fullWidth
          onPress={() => finish.mutate(sessionId)}
          loading={finish.isPending}
        />
      ) : null}
    </Screen>
  );
}
