import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { loadRuleset, validateWeekdays, weekdayLayoutNote } from '@vert/engine';
import type { Sport } from '@vert/engine';
import { readBestSets } from '@/lib/engineAthlete';
import { AppHeader, href } from '@/app';
import {
  kvStore,
  useAthlete,
  useReadinessTests,
  useCurrentProgram,
  useDbOrNull,
  useExportData,
  usePainStatus,
  useReportPain,
  useSessionsBetween,
  useSetAutoregulation,
  useSetWorkingMax,
  useToday,
  useUpdateAthlete,
  useWeeks,
  useWhoopConnection,
  type Athlete,
  type PainStatus,
} from '@/data';
import { EmptyState, Notice, Screen, Skeleton, Text, space } from '@/ui';
import { useSetupPrefill } from '@/state/setupPrefill';
import { AthleteSection, ReassessSheet, type AthleteAnswer } from './athleteSection';
import { AutoregulationSection } from './autoregulationSection';
import { DataSection } from './dataSection';
import { SyncSection } from './syncSection';
import { LiftsSection } from './liftsSection';
import { LinkSection } from './linkSection';
import { ProgramSection } from './programSection';
import { draftFrom, type ProgramDraft } from './programDraft';
import { paramsOf, savedParams, sportOf } from './programParams';
import { ReadinessSection } from './readinessSection';
import {
  BUILD_PROGRAM_ROUTE,
  NO_PROFILE_LINE,
  settingsView,
  type SettingsSectionId,
} from './sections';
import { buildExportFiles, type ExportFile } from './exportData';
import { SaveFailedError, saveFile } from './download';
import { deleteAllData, clearDeviceSecret } from './deleteAll';
import {
  diffParams,
  needsRegeneration,
  nextUnstartedWeek,
  weekProgressFrom,
  regenerationPlan,
  PAIN_APPLIED_LINE,
} from './regenerate';
import { useRegenerate } from './useRegenerate';
import { useSettingsFacts } from './useSettingsFacts';
import {
  climbingAnswersFrom,
  climbingPatchFrom,
  clockWindowFrom,
  readinessConfigValuesFrom,
  bestSetsDraftFrom,
  bestSetsFrom,
  maxRowsFor,
  showsGripBlock,
  toReadinessTestConfig,
  wallWorkFrom,
  type BestSetsDraft,
  type ReadinessConfigValues,
} from '../setup';
import type { Json } from '@/data';

/** The app version shown in About and stamped into the JSON export. */
export const APP_VERSION = '0.1.0';

export function SettingsScreen() {
  const router = useRouter();
  const requestOwnerPrefill = useSetupPrefill((state) => state.requestOwnerPrefill);
  const db = useDbOrNull();
  const today = useToday();

  const athleteQuery = useAthlete();
  const painQuery = usePainStatus();
  const programQuery = useCurrentProgram();
  const weeksQuery = useWeeks(programQuery.data?.id);
  // The sessions, not just the week counters: whether a week may be rebuilt
  // turns on real work in it, and `week.completed_count` alone cannot tell a
  // session the athlete opened from one they finished.
  const sessionsQuery = useSessionsBetween(
    programQuery.data?.startDate,
    programQuery.data?.endDate,
  );
  const whoopQuery = useWhoopConnection();

  const updateAthlete = useUpdateAthlete();
  const setWorkingMax = useSetWorkingMax();
  const setAutoregulation = useSetAutoregulation();
  const reportPain = useReportPain();
  const regenerate = useRegenerate();

  const athlete = athleteQuery.data ?? null;
  const pain = painQuery.data ?? [];
  const program = programQuery.data ?? null;

  const [answers, setAnswers] = useState<Partial<Athlete>>({});
  const [draft, setDraft] = useState<ProgramDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reassessing, setReassessing] = useState<PainStatus | null>(null);
  const [painNote, setPainNote] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tipsReset, setTipsReset] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyLift, setBusyLift] = useState<string | null>(null);

  const activeDraft = draft ?? (athlete === null ? null : draftFrom(athlete));

  const facts = useSettingsFacts(athlete, pain);
  const readinessConfig = useMemo(
    () => readinessConfigValuesFrom(athlete?.readinessConfig),
    [athlete?.readinessConfig],
  );
  const readinessTests = useReadinessTests(readinessConfig.kind);

  const bestSetsDraft = useMemo(
    () =>
      athlete === null
        ? {}
        : bestSetsDraftFrom(
            readBestSets(athlete.bestSets ?? null),
            maxRowsFor(sportOf(athlete.sport)).map((row) => row.field),
            today,
          ),
    [athlete, today],
  );

  const saveBestSets = useCallback(
    (draft: BestSetsDraft) => {
      updateAthlete.mutate({ bestSets: bestSetsFrom(draft, today) as unknown as Json });
    },
    [today, updateAthlete],
  );

  const saveReadiness = useCallback(
    (next: ReadinessConfigValues) => {
      updateAthlete.mutate({
        readinessConfig: toReadinessTestConfig(next) as unknown as Json,
      });
    },
    [updateAthlete],
  );
  const exportQuery = useExportData(exportOpen);

  const files = useMemo<ExportFile[]>(() => {
    const data = exportQuery.data;
    if (data === undefined) return [];
    return buildExportFiles({ ...data, appVersion: APP_VERSION });
  }, [exportQuery.data]);

  const weekdayVerdict = useMemo(() => {
    const none = { refusal: null, note: null };
    if (activeDraft === null || athlete?.daysPerWeek == null) return none;
    if (activeDraft.weekdays.length !== athlete.daysPerWeek) {
      return { refusal: `Pick ${athlete.daysPerWeek} training days.`, note: null };
    }
    // A climber's picks are checked against the wall-aware placement, which is
    // what the generator will build (`house.sc.sport_requirements`).
    const wall = wallWorkFrom({
      ...climbingAnswersFrom(athlete),
      wallWorkDays: activeDraft.wallWorkDays,
      wallStart: activeDraft.wallStart,
      wallEnd: activeDraft.wallEnd,
      wallFingerHard: activeDraft.wallFingerHard,
      wallGapHours: activeDraft.wallGapHours,
    });
    // The gym window as the draft has it, not as the row has it: the picks are
    // read against what the confirm is about to write.
    const window = clockWindowFrom(activeDraft.gymStart, activeDraft.gymEnd);
    const context = {
      sport: (athlete.sport ?? 'none') as Sport,
      ...(wall === null ? null : { wallWork: wall }),
      ...(window === null ? null : { sessionWindow: window }),
    };
    const picks = [...activeDraft.weekdays];
    const verdict = validateWeekdays(picks, athlete.daysPerWeek, loadRuleset(), context);
    if (!verdict.ok) return { refusal: verdict.reason, note: null };
    // A pick that cannot carry the hard pulling day is not refused; the
    // program demotes those pulls, and the sheet says so beside the days.
    return {
      refusal: null,
      note: weekdayLayoutNote(picks, athlete.daysPerWeek, loadRuleset(), context),
    };
  }, [activeDraft, athlete]);
  const weekdayRefusal = weekdayVerdict.refusal;
  const weekdayNote = weekdayVerdict.note;

  const changes = useMemo(() => {
    if (athlete === null || activeDraft === null) return [];
    return diffParams(savedParams(athlete), paramsOf(athlete, activeDraft, answers));
  }, [athlete, activeDraft, answers]);

  const fromWeek = useMemo(
    () =>
      nextUnstartedWeek(
        weekProgressFrom(weeksQuery.data ?? [], sessionsQuery.data ?? []),
        today,
      ),
    [weeksQuery.data, sessionsQuery.data, today],
  );

  const plan = confirming ? regenerationPlan(changes, fromWeek, program !== null) : null;

  const onAnswer = useCallback((answer: AthleteAnswer) => {
    setAnswers((current) => ({ ...current, [answer.field]: answer.value }));
    setConfirming(true);
  }, []);

  const discard = useCallback(() => {
    setConfirming(false);
    setAnswers({});
    setDraft(null);
    regenerate.reset();
  }, [regenerate]);

  const confirm = useCallback(() => {
    if (athlete === null || activeDraft === null) return;
    const patch: Partial<Athlete> = {
      ...answers,
      weekdays: activeDraft.weekdays,
      sessionWindow: clockWindowFrom(activeDraft.gymStart, activeDraft.gymEnd) as unknown as Json,
      goalHeightMm: activeDraft.goalHeightMm,
      targetDate: activeDraft.targetDate,
      inSeason: activeDraft.inSeason,
      bodyweightKg: activeDraft.bodyweightKg,
      ...climbingPatchFrom(
        {
          ...climbingAnswersFrom({ ...athlete, ...answers }),
          wallWorkDays: activeDraft.wallWorkDays,
          wallStart: activeDraft.wallStart,
          wallEnd: activeDraft.wallEnd,
          wallFingerHard: activeDraft.wallFingerHard,
          wallGapHours: activeDraft.wallGapHours,
          valgusControl: activeDraft.valgusControl,
        },
        showsGripBlock(
          answers.sport ?? athlete.sport,
          climbingAnswersFrom({ ...athlete, ...answers }).fingerHistory,
        ),
      ),
    };
    regenerate.mutate(
      {
        athlete,
        pain,
        program,
        patch,
        changes,
        fromWeek: needsRegeneration(changes) ? fromWeek : null,
      },
      { onSuccess: () => discard() },
    );
  }, [athlete, activeDraft, answers, changes, discard, fromWeek, pain, program, regenerate]);

  const onSave = useCallback(async (file: ExportFile) => {
    setSavingName(file.name);
    setSaveError(null);
    try {
      const outcome = await saveFile(file);
      if (outcome === 'unavailable') {
        setSaveError('This device cannot share files. Open the app on the web to export.');
      }
    } catch (caught) {
      setSaveError(
        caught instanceof SaveFailedError
          ? caught.message
          : 'Could not write the file. Free some space and try again.',
      );
    } finally {
      setSavingName(null);
    }
  }, []);

  const view = settingsView({ hasAthlete: athlete !== null, hasProgram: program !== null });

  if (athleteQuery.isPending || programQuery.isPending || db === null) {
    return (
      <Screen header={<AppHeader title="Settings" showSettings={false} />} testID="settings-loading">
        <Skeleton skeletonFor="header" />
        <Skeleton skeletonFor="line" count={8} />
      </Screen>
    );
  }

  if (athlete === null || view.empty) {
    return (
      <Screen header={<AppHeader title="Settings" showSettings={false} />} testID="settings-empty">
        <EmptyState
          body={NO_PROFILE_LINE}
          actionLabel="Build program"
          onAction={() => router.push(href('/setup/gate'))}
        />
      </Screen>
    );
  }

  // Answers exist, so every section reads from them; only the Program section
  // changes shape while there is nothing built.
  const programDraft = activeDraft ?? draftFrom(athlete);
  const sections: Readonly<Record<SettingsSectionId, ReactNode>> = {
    athlete: (
      <AthleteSection
        athlete={{ ...athlete, ...answers }}
        pain={pain}
        onAnswer={onAnswer}
        onReassessPain={setReassessing}
        onReportPain={() => router.push(href('/clearance'))}
      />
    ),
    program: (
      <ProgramSection
        athlete={{ ...athlete, ...answers }}
        built={view.program === 'built'}
        onBuild={() => router.push(href(BUILD_PROGRAM_ROUTE))}
        draft={programDraft}
        onDraft={(next) => {
          setDraft(next);
          setConfirming(false);
        }}
        weekdayRefusal={weekdayRefusal}
        weekdayNote={weekdayNote}
        plan={plan}
        saving={regenerate.isPending}
        error={regenerate.error === null ? null : regenerate.error.message}
        onConfirm={confirm}
        onDiscard={discard}
      />
    ),
    lifts: (
      <LiftsSection
        lifts={facts.lifts}
        busyLiftId={busyLift}
        onUseEstimate={(exerciseId, estimateKg) => {
          setBusyLift(exerciseId);
          setWorkingMax.mutate(
            {
              exerciseId,
              valueKg: estimateKg,
              source: 'epley',
              confidence: 0.95,
              frozenAt: new Date().toISOString(),
              lastRaiseAt: null,
            },
            { onSettled: () => setBusyLift(null) },
          );
        }}
        sport={sportOf(athlete.sport)}
        bestSets={bestSetsDraft}
        today={today}
        onSaveBestSets={saveBestSets}
        savingBestSets={updateAthlete.isPending}
      />
    ),
    readiness: (
      <ReadinessSection
        config={readinessConfig}
        tests={readinessTests.data ?? []}
        onSave={saveReadiness}
        saving={updateAthlete.isPending}
      />
    ),
    link: (
      <LinkSection
        whoopStatus={whoopQuery.data?.status ?? 'disconnected'}
        lastSyncAt={whoopQuery.data?.lastSyncAt ?? null}
        onWhoop={() => router.push(href('/settings/whoop'))}
        onImport={() => router.push(href('/settings/import'))}
      />
    ),
    autoregulation: (
      <AutoregulationSection
        gate={facts.gate}
        shadow={facts.shadow}
        enabled={facts.autoregulationEnabled}
        pausedReason={facts.pausedReason}
        busy={setAutoregulation.isPending}
        onToggle={(next) => setAutoregulation.mutate({ enabled: next })}
      />
    ),
    data: (
      <View onLayout={() => { if (!exportOpen) setExportOpen(true); }}>
        <SyncSection />
        <DataSection
          files={files}
          onSave={(file) => void onSave(file)}
          savingName={savingName}
          saveError={saveError}
          timezone={athlete.timezone}
          rolloverHour={athlete.rolloverHour}
          onEditRollover={(hour) => updateAthlete.mutate({ rolloverHour: hour })}
          onResetTips={() => {
            if (db === null) return;
            void kvStore.resetCoachMarks(db).then(() => setTipsReset(true));
          }}
          tipsReset={tipsReset}
          onUseSavedProfile={() => {
            requestOwnerPrefill();
            router.push(href('/setup/one'));
          }}
          deleting={deleting}
          onDeleteAll={() => {
            if (db === null) return;
            setDeleting(true);
            void deleteAllData(db)
              .then(() => router.replace(href('/setup/gate')))
              .finally(() => setDeleting(false));
          }}
          onSignOut={() => {
            if (db === null) return;
            void clearDeviceSecret(db).then(() => router.replace(href('/login')));
          }}
          onPrivacy={() => router.push(href('/privacy'))}
          appVersion={APP_VERSION}
        />
      </View>
    ),
  };

  return (
    <Screen
      header={<AppHeader title="Settings" showSettings={false} />}
      gap={space.xxl}
      testID="settings-screen"
    >
      {athleteQuery.isError ? (
        <Notice
          text="Showing the saved copy. Retry to read the latest."
          actionLabel="Retry"
          onAction={() => void athleteQuery.refetch()}
          live
        />
      ) : null}

      {painNote === null ? null : <Notice text={painNote} live />}

      {changes.length > 0 && !confirming ? (
        <Notice
          text={`${changes.length === 1 ? '1 change' : `${changes.length} changes`} not saved yet.`}
          actionLabel="Review changes"
          onAction={() => setConfirming(true)}
          live
        />
      ) : null}

      {view.sections.map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}

      {exportQuery.isPending && exportOpen ? (
        <Text variant="caption" color="ink3">
          Gathering your data for export.
        </Text>
      ) : null}

      <ReassessSheet
        visible={reassessing !== null}
        pain={reassessing}
        onClose={() => setReassessing(null)}
        onAnswer={(severity, durationWeeks) => {
          const target = reassessing;
          setReassessing(null);
          if (target === null) return;
          reportPain.mutate(
            {
              location: target.location,
              severityRaw:
                severity === 'gone' ? 0 : severity === '1-2' ? 2 : severity === '3-4' ? 4 : 6,
              severityDerived:
                severity === 'gone'
                  ? 'none'
                  : severity === '1-2'
                    ? 'mild'
                    : severity === '3-4'
                      ? 'moderate'
                      : 'severe',
              durationWeeks,
              onset: durationWeeks >= 12 ? 'chronic' : 'acute',
              note: severity === 'gone' ? 'reassessed: gone' : 'reassessed',
            },
            { onSuccess: () => setPainNote(PAIN_APPLIED_LINE) },
          );
        }}
      />
    </Screen>
  );
}
