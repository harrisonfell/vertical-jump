import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { Week } from '@/data';
import { usePatchSession, useSetKvValue } from '@/data';
import { AppHeader, SyncLine } from '@/app';
import { Button, FooterLine, Notice, RestBar, Screen, Text, space } from '@/ui';
import { COACH_MARK_FIRST_SESSION, COACH_MARK_LINES, sorenessSkipKey } from './cards';
import { EditSetSheet } from './editSetSheet';
import { NO_SETS, RunnerExercise } from './exerciseSection';
import { FingerRow } from './fingerRow';
import { FinishSheet } from './finishSheet';
import { countContacts, footerLeft, footerRight, plannedSets } from './footer';
import { GroupedBlock } from './groupedBlock';
import { headerDate, headerDuration, headerTitle } from './header';
import { JumpTestBlock } from './jumpTestBlock';
import { flattenExercises, type TodayExercise } from './model';
import { isSoreEnough, repeatNotice, sorenessNotices, testMovedFrom } from './notices';
import { ReadinessRow } from './readinessRow';
import { useRunnerActions } from './runnerActions';
import { SorenessRow } from './sorenessRow';
import { TodayCards } from './todayCards';
import { useTodayUi } from './todayStore';
import { useClimbAnswers } from './useClimbAnswers';
import { useFinishFlow } from './useFinishFlow';
import { useKeepAwakeWhile, useRestTimer } from './useRestTimer';
import type { TodayData } from './useTodayData';
import { WhoopStrip } from './whoopStrip';

/**
 * Today, running a session.
 *
 * There is no Start button: the first row tap stamps the start time. Every tap
 * writes a row locally inside a transaction and a second tap on the same row
 * takes it back, so the gym works with the phone in airplane mode and nothing
 * on this screen ever waits on a network. What a tap does is in
 * `runnerActions`; this file is the layout.
 */

export interface SessionRunnerProps {
  readonly data: TodayData;
  readonly nextWeek: Week | null;
  /**
   * Tells Today the Finish sheet is open, so the screen does not swap the
   * runner for the summary while the outcome line is still being read.
   */
  readonly onFinishSheet?: (open: boolean) => void;
}

export function SessionRunner({ data, nextWeek, onFinishSheet }: SessionRunnerProps) {
  const { session, plan, week } = data;
  const patchSession = usePatchSession();
  const setKv = useSetKvValue();
  const rest = useRestTimer();

  const store = useTodayUi(
    COACH_MARK_FIRST_SESSION,
    data.forced === 'coachMark' || (week?.w === 1 && data.lastCompletedDate === null),
  );
  const scroll = useRef<ScrollView | null>(null);

  const [finishOpen, setFinishOpenState] = useState(false);
  const setFinishOpen = useCallback(
    (open: boolean) => {
      setFinishOpenState(open);
      onFinishSheet?.(open);
    },
    [onFinishSheet],
  );

  const exercises = useMemo(() => (plan === null ? [] : flattenExercises(plan)), [plan]);
  const planned = useMemo(() => (plan === null ? 0 : plannedSets(plan)), [plan]);
  const loggedCount = data.logs.length;
  // Walks every set of every exercise, and the rest bar re-renders this
  // component once a second, so it is not allowed to run on a tick.
  const tally = useMemo(
    () => countContacts(exercises, data.repsByExercise),
    [data.repsByExercise, exercises],
  );

  const scrollTo = useCallback((y: number) => {
    scroll.current?.scrollTo({ y, animated: true });
  }, []);

  const actions = useRunnerActions({ data, exercises, rest, scrollTo });
  const answers = useClimbAnswers(data);

  const finishFlow = useFinishFlow({
    sessionId: session?.id ?? null,
    week,
    nextWeek,
    plan,
    logs: data.logs,
    isWeekFinalWorkout: data.isWeekFinalWorkout,
    programId: data.program?.id ?? null,
  });

  useKeepAwakeWhile(session !== null && session.status !== 'done');

  const toggle = store.toggleExercise;
  const onToggleExercise = useCallback(
    (exercise: TodayExercise) => toggle(exercise.id),
    [toggle],
  );

  if (session === null || plan === null) return null;

  const warmUp = plan.blocks.find((block) => block.name === 'warm_up');
  const warmUpUnchecked =
    warmUp !== undefined &&
    warmUp.exercises.some(
      (exercise) => (data.loggedByExercise.get(exercise.id)?.size ?? 0) < exercise.sets.length,
    );
  const everythingLogged = planned > 0 && loggedCount >= planned;

  const title = headerTitle({
    w: week?.w ?? 1,
    W: data.totalWeeks,
    blockType: data.blockType,
    dayType: session.dayType,
    suffixes: plan.headerSuffixes,
    restricted: data.restricted,
  });

  const finishLink = (
    <Button
      label="Finish session"
      variant="quiet"
      onPress={() => setFinishOpen(true)}
      testID="finish-link"
    />
  );

  return (
    <Screen
      scroll={false}
      contentStyle={{ flex: 1 }}
      header={
        <AppHeader
          title={title}
          trailingText={headerDate(session.scheduledDate)}
          {...(headerDuration(plan.estimatedMinutes) === undefined
            ? null
            : { subtitle: headerDuration(plan.estimatedMinutes) })}
        />
      }
      footer={
        rest.running ? (
          <RestBar
            remainingS={rest.remainingS}
            nextLine={rest.nextLabel}
            onStop={rest.stop}
            trailing={everythingLogged ? finishLink : undefined}
          />
        ) : undefined
      }
      testID="today-runner"
    >
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SyncLine />
        <WhoopStrip today={data.today} />

        {/* Channel A sits under the strip it reads; channel B is the control
            beside it. Never averaged (`house.sc.readiness_gate`). */}
        {data.readinessConfig === null || data.readiness === null ? null : (
          <ReadinessRow
            model={data.readiness}
            config={data.readinessConfig}
            skipped={data.readinessSkipped}
            onSave={answers.saveThrow}
            onSkip={answers.skipThrow}
            saving={answers.saving}
            saveError={answers.saveError}
            testID="today-readiness"
          />
        )}

        <SorenessRow
          value={session.sorenessPre}
          skipped={data.sorenessSkipped}
          onAnswer={(value) => {
            patchSession.mutate({ sessionId: session.id, patch: { sorenessPre: value } });
            setKv.mutate({ key: sorenessSkipKey(session.id), value: null });
          }}
          onSkip={() => {
            // A declined question is a decision: it survives leaving the screen.
            patchSession.mutate({ sessionId: session.id, patch: { sorenessPre: null } });
            setKv.mutate({ key: sorenessSkipKey(session.id), value: data.today });
          }}
          testID="today-soreness"
        />

        {/* Asked only where there is hard finger work to take off
            (`house.sc.finger_pain_ceiling`). */}
        {data.fingerAsked ? (
          <FingerRow
            value={data.fingerAnswer?.value ?? null}
            answered={data.fingerAnswer !== null}
            onAnswer={answers.answerFinger}
            onSkip={answers.skipFinger}
            testID="today-finger-pain"
          />
        ) : null}

        <TodayCards data={data} />

        {[
          ...sorenessNotices({
            sorenessPre: session.sorenessPre,
            isTestDay: plan.isTestDay,
            today: data.today,
            weekSessions: data.weekSessions,
          }),
          ...plan.notices,
          ...(repeatNotice(week?.repeatOfWeek ?? null) === null
            ? []
            : [repeatNotice(week?.repeatOfWeek ?? null) ?? '']),
        ].map((notice) => (
          <Notice key={notice} text={notice} live testID="today-notice" />
        ))}

        {plan.trimmed.length === 0 ? null : (
          <Text variant="caption" color="ink3">
            {`Trimmed to hold the exercise cap: dropped ${plan.trimmed
              .map((entry) => entry.name)
              .join(', ')}`}
          </Text>
        )}

        {store.coachMarkVisible ? (
          <Notice
            text={COACH_MARK_LINES.join(' ')}
            actionLabel="Got it"
            onAction={() => store.dismissCoachMark(COACH_MARK_FIRST_SESSION)}
            testID="today-coach-mark"
          />
        ) : null}

        {actions.failed === null ? null : (
          <Notice
            text="Couldn't save that set. Check your connection."
            actionLabel="Retry"
            onAction={actions.retry}
            live
            testID="today-log-error"
          />
        )}

        {plan.blocks.map((block) => (
          <View key={block.name} style={{ gap: space.sm }}>
            {/* R27 defers a scheduled test: the notice above says where it went. */}
            {block.name === 'jump_test' && isSoreEnough(session.sorenessPre) ? null : block.name ===
              'jump_test' ? (
              <JumpTestBlock
                today={data.today}
                sessionId={session.id}
                bodyweightKg={data.athlete?.bodyweightKg ?? null}
                eyebrow={`Jump test · ${headerDate(session.scheduledDate)}`}
                movedFrom={testMovedFrom(data.weekSessions, data.today)}
                testID="today-jump-test"
              />
            ) : block.grouped ? (
              <GroupedBlock
                label={block.label}
                exercises={block.exercises}
                loggedByExercise={data.loggedByExercise}
                onLogAll={() => actions.logGroup(block.exercises)}
                onUndoAll={() => actions.undoGroup(block.exercises)}
                testID={`block-${block.name}`}
              />
            ) : (
              <View style={{ gap: space.sm }}>
                <Text variant="label" color="ink2">
                  {block.label}
                </Text>
                {block.exercises.map((exercise) => (
                  <RunnerExercise
                    key={exercise.id}
                    exercise={exercise}
                    logged={data.loggedByExercise.get(exercise.id) ?? NO_SETS}
                    logByKey={data.logByKey}
                    generation={actions.generation[exercise.id] ?? 0}
                    collapsed={!store.expandedExerciseIds.includes(exercise.id)}
                    onToggle={onToggleExercise}
                    onLog={actions.onLogRow}
                    onUndo={actions.onUndo}
                    onEdit={actions.openEdit}
                    onFillRemaining={actions.fillRemaining}
                    landingPending={actions.landingFor === exercise.id}
                    onLanding={actions.answerLanding}
                    onAnchor={actions.onAnchor}
                  />
                ))}
              </View>
            )}
          </View>
        ))}

        <FooterLine
          left={footerLeft({
            setsLogged: loggedCount,
            setsPlanned: planned,
            contacts: plan.contacts,
            tally,
          })}
          {...(footerRight(data.nextTest) === undefined
            ? null
            : { right: footerRight(data.nextTest) })}
          testID="today-footer"
        />

        <Button
          label="Finish session"
          variant="primary"
          size={56}
          fullWidth
          onPress={() => setFinishOpen(true)}
          testID="finish-session"
        />
      </ScrollView>

      <EditSetSheet
        visible={actions.editing !== null}
        onClose={actions.closeEdit}
        exercise={actions.editing?.exercise ?? null}
        set={actions.editing?.set ?? null}
        log={
          actions.editing === null
            ? null
            : actions.logFor(actions.editing.exercise.id, actions.editing.set.setNumber)
        }
        saving={actions.saving}
        error={actions.editError}
        onSave={actions.saveEdit}
        onDelete={actions.deleteEdit}
      />

      <FinishSheet
        visible={finishOpen}
        onClose={() => setFinishOpen(false)}
        flow={finishFlow}
        sorenessPre={session.sorenessPre}
        warmUpUnchecked={warmUpUnchecked}
        onWarmUpChecked={() => {
          if (warmUp !== undefined) actions.logGroup(warmUp.exercises);
        }}
        partialLine={
          everythingLogged ? null : `${loggedCount} of ${planned} sets logged`
        }
        onFinished={() => undefined}
      />
    </Screen>
  );
}
