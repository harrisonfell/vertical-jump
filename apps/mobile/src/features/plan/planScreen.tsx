import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { loadRuleset } from '@vert/engine';
import { AppHeader, href, routeHref } from '@/app';
import {
  useAthlete,
  useBlocks,
  useCurrentProgram,
  useProgramVersions,
  useSessionsBetween,
  useWeeks,
} from '@/data/hooks';
import { useTimezone, useToday } from '@/data/db';
import type { ProgramVersion } from '@/data/types';
import { Disclosure, EmptyState, Hairline, Screen, Skeleton, Text, space } from '@/ui';
import { BlockBand } from './blockBand';
import { readSkeleton } from './engine';
import { versionNote } from './header';
import { buildPlanModel } from './model';
import { RulesSummary } from './rulesSummary';
import { readPlanStates } from './states';
import { VersionHistory } from './versionHistory';
import { WeekStrip } from './weekStripView';
import { localDay } from '@/lib/localDay';

/**
 * Plan: the program as calendar weeks.
 *
 * Top to bottom it answers four questions in the order they get asked. What is
 * this program? Where am I in this week? What shape is the program? What is on
 * each day? Everything that explains rather than reports, the rules and the
 * version history, sits behind a disclosure at the bottom.
 */

const EMPTY_BODY =
  'No program yet: twelve weeks are built from five answers and a target date.';

function PlanSkeletonView() {
  return (
    <Screen wide header={<AppHeader title="Plan" />}>
      <Skeleton skeletonFor="line" count={2} />
      <Skeleton skeletonFor="strip" />
      <Skeleton skeletonFor="chartPanel" count={3} />
    </Screen>
  );
}

export function PlanScreen() {
  const router = useRouter();
  const today = useToday();
  const timezone = useTimezone();
  const params = useLocalSearchParams<{ plan?: string }>();
  const states = useMemo(() => readPlanStates(params.plan), [params.plan]);

  const athlete = useAthlete();
  const program = useCurrentProgram();
  const programId = program.data?.id;
  const weeks = useWeeks(programId);
  const blocks = useBlocks(programId);
  const versions = useProgramVersions(programId);
  const sessions = useSessionsBetween(program.data?.startDate, program.data?.endDate);

  const skeleton = useMemo(
    () => (program.data === null || program.data === undefined ? null : readSkeleton(program.data.snapshot)),
    [program.data],
  );

  const ruleset = useMemo(() => loadRuleset(), []);

  const model = useMemo(
    () =>
      buildPlanModel({
        athlete: athlete.data ?? null,
        program: program.data ?? null,
        skeleton,
        blocks: blocks.data ?? [],
        weeks: weeks.data ?? [],
        sessions: sessions.data ?? [],
        today,
        states,
      }),
    [athlete.data, blocks.data, program.data, sessions.data, skeleton, states, today, weeks.data],
  );

  const loading = states.has('loading') || program.isPending || athlete.isPending;
  if (loading) return <PlanSkeletonView />;

  if (states.has('empty') || program.data === null || program.data === undefined) {
    return (
      <Screen wide header={<AppHeader title="Plan" variant="headline" />}>
        <EmptyState
          body={EMPTY_BODY}
          actionLabel="Build program"
          onAction={() => router.push(routeHref('setupOne'))}
        />
      </Screen>
    );
  }

  const stored = versions.data ?? [];
  const shown: readonly ProgramVersion[] = states.has('versions')
    ? [
        {
          id: 'demo-v2',
          programId: program.data.id,
          version: (stored[0]?.version ?? 1) + 1,
          weekLayout: stored[0]?.weekLayout ?? null,
          reason: 'target date moved',
          createdAt: program.data.updatedAt,
        },
        ...stored,
      ]
    : stored;

  const latest = shown[0];

  return (
    <Screen wide header={<AppHeader title={model.title} />}>
      <View style={{ gap: space.xs }}>
        <Text variant="body" color="ink" numeric>
          {model.headerLine}
        </Text>
        {shown.length < 2 || latest === undefined ? null : (
          <Text variant="caption" color="ink3" numeric>
            {versionNote({
              version: latest.version,
              since: localDay(latest.createdAt, timezone),
              reason: latest.reason,
            })}
          </Text>
        )}
      </View>

      {model.ladder === null ? null : (
        <View>
          <Hairline />
          <View style={{ paddingVertical: space.md }}>
            <Text variant="title" color="ink" numeric accessibilityLiveRegion="polite">
              {model.ladder}
            </Text>
          </View>
          <Hairline />
        </View>
      )}

      <BlockBand segments={model.segments} currentWeek={model.currentWeek} testID="plan-band" />

      <WeekStrip
        strip={model.strip}
        onOpen={(sessionId) => router.push(href(`/session/${sessionId}`))}
        testID="plan-strip"
      />

      {model.projectionLine === null ? null : (
        <Text variant="caption" color="ink3" testID="plan-projection-line">
          {model.projectionLine}
        </Text>
      )}

      {model.thisWeekLines.length === 0 ? null : (
        <View style={{ gap: space.xs }}>
          <Text variant="label" color="ink2">
            This week
          </Text>
          {model.thisWeekLines.map((line, index) => (
            <View key={`${index}-${line}`}>
              <Hairline />
              <Text variant="body" color="ink" style={{ paddingVertical: space.sm, maxWidth: 560 }}>
                {line}
              </Text>
            </View>
          ))}
        </View>
      )}

      {model.earlier.length === 0 ? null : (
        <Disclosure title="Earlier weeks" summary={`${model.earlier.length}`}>
          {model.earlier.map((entry) => (
            <View key={entry.w}>
              <Hairline />
              <Text variant="caption" color="ink2" style={{ paddingVertical: space.sm, maxWidth: 560 }}>
                {entry.line}
              </Text>
            </View>
          ))}
        </Disclosure>
      )}

      <RulesSummary ruleset={ruleset} appliedIds={model.appliedRuleIds} testID="plan-rules" />
      <VersionHistory versions={shown} timezone={timezone} testID="plan-versions" />
    </Screen>
  );
}
