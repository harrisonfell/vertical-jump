import { View } from 'react-native';
import { Disclosure, Hairline, Table, Text, space, type TableColumn } from '@/ui';
import { LoadVelocityChart, useChartSize } from '@/ui/charts';
import { NO_VALUE } from './derive';
import type { LiftRow, ReadinessRep, ReadinessRow, TopSetRow, WeekRow } from './types';

/**
 * Every column is width-fitted to its own header and values, so the last one
 * ("Outcome") cannot be squeezed into "OU…" by the column beside it. The
 * widths add up to WEEK_TABLE_WIDTH, which the table scrolls inside itself
 * rather than clipping when the right-hand column is narrower than that.
 */
const WEEK_COLUMNS: readonly TableColumn<WeekRow>[] = [
  { key: 'w', header: 'Week', width: 88, render: (row) => row.label },
  { key: 'sessions', header: 'Done', width: 56, numeric: true, render: (row) => row.sessions },
  { key: 'percent', header: 'Rate', width: 56, numeric: true, render: (row) => row.percent },
  { key: 'reps', header: 'All reps', width: 64, render: (row) => row.allReps },
  { key: 'outcome', header: 'Outcome', width: 96, render: (row) => row.outcome },
];

/** The five column widths plus the four 12px gaps between them. */
const WEEK_TABLE_WIDTH = 88 + 56 + 56 + 64 + 96 + 4 * space.md;

export interface WeeksSectionProps {
  readonly rows: readonly WeekRow[];
  readonly earlier: readonly WeekRow[];
}

/**
 * Adherence by week: sessions marked complete over sessions scheduled that
 * calendar week, Recovery days included, and the outcome the engine applied.
 * No streak, no aggregate badge; the numbers are the whole story.
 */
export function WeeksSection({ rows, earlier }: WeeksSectionProps) {
  return (
    <Disclosure
      title="Weeks"
      summary={`${rows.length + earlier.length} weeks`}
      defaultOpen
      testID="progress-weeks"
    >
      <Table
        columns={WEEK_COLUMNS}
        rows={rows}
        rowKey={(row) => `w${row.w}`}
        caption="Adherence by week"
        minWidth={WEEK_TABLE_WIDTH}
        emptyText="No weeks logged yet."
      />
      {earlier.length === 0 ? null : (
        <Disclosure title="Earlier weeks" summary={`${earlier.length} weeks`}>
          <View style={{ gap: space.sm }}>
            {earlier
              .slice()
              .reverse()
              .map((row) => (
                <Text key={`review-${row.w}`} variant="caption" color="ink2" numeric>
                  {row.reviewLine}
                </Text>
              ))}
          </View>
        </Disclosure>
      )}
    </Disclosure>
  );
}

const TOP_SET_COLUMNS: readonly TableColumn<TopSetRow>[] = [
  { key: 'date', header: 'Date', width: 72, render: (row) => row.dateLabel },
  { key: 'set', header: 'Top set', numeric: true, render: (row) => row.setLabel },
  { key: 'rpe', header: 'Effort', width: 72, render: (row) => row.rpe },
];

/** Four points is where a load-velocity line stops being a guess with a slope. */
const MIN_VELOCITY_POINTS = 4;

export interface LiftsSectionProps {
  readonly lifts: readonly LiftRow[];
}

/**
 * One row a loadable lift: the working max and where it came from, then the
 * history behind a disclosure. Numbers first, a chart only once there are
 * enough points for it to say something the numbers do not.
 */
export function LiftsSection({ lifts }: LiftsSectionProps) {
  const { width, onLayout } = useChartSize();

  return (
    <Disclosure title="Lifts" summary={`${lifts.length} lifts`} testID="progress-lifts">
      <View style={{ gap: space.lg }} onLayout={onLayout}>
        {lifts.length === 0 ? (
          <Text variant="caption" color="ink3">
            No loaded sets logged yet.
          </Text>
        ) : null}
        {lifts.map((lift) => (
          <View key={lift.exerciseId} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
              <Text variant="title" color="ink" style={{ flex: 1 }}>
                {lift.name}
              </Text>
              <Text
                variant="title"
                color={lift.workingMaxLb === null ? 'ink3' : 'ink'}
                numeric={lift.workingMaxLb !== null}
              >
                {lift.workingMaxLb ?? NO_VALUE}
              </Text>
            </View>
            <Text variant="caption" color="ink2">
              {lift.sourceLine}
            </Text>
            {lift.dropLine === null ? null : (
              <Text variant="caption" color="ink2" numeric>
                {lift.dropLine}
              </Text>
            )}

            <Disclosure title="Top-set history" summary={`${lift.topSets.length} sessions`}>
              <Table
                columns={TOP_SET_COLUMNS}
                rows={lift.topSets}
                rowKey={(row) => `${lift.exerciseId}-${row.date}`}
                caption={`${lift.name} top sets`}
                minWidth={360}
              />
              {lift.velocityPoints.length >= MIN_VELOCITY_POINTS ? (
                <LoadVelocityChart
                  points={lift.velocityPoints}
                  width={width}
                  lift={lift.name}
                />
              ) : (
                <Text variant="caption" color="ink3">
                  {`Load-velocity line after ${MIN_VELOCITY_POINTS} velocity sets (${lift.velocityPoints.length} so far).`}
                </Text>
              )}
            </Disclosure>
            <Hairline />
          </View>
        ))}
      </View>
    </Disclosure>
  );
}

const READINESS_COLUMNS: readonly TableColumn<ReadinessRow>[] = [
  { key: 'date', header: 'Date', width: 72, render: (row) => row.dateLabel },
  { key: 'reps', header: 'Reactive', width: 72, numeric: true, render: (row) => `${row.reactive}` },
  { key: 'rsi', header: 'Mean RSI', width: 88, numeric: true, render: (row) => row.meanRsi },
  { key: 'gct', header: 'Mean contact', width: 96, numeric: true, render: (row) => row.meanGct },
  { key: 'best', header: 'Best', width: 72, numeric: true, render: (row) => row.bestHeight },
];

/** The five widths plus their gaps, so the last column is never clipped. */
const READINESS_TABLE_WIDTH = 72 + 72 + 88 + 96 + 72 + 4 * space.md;

export interface ReadinessSectionProps {
  readonly rows: readonly ReadinessRow[];
  readonly reps: readonly ReadinessRep[];
}

/**
 * Jump readiness from the optional drop-jump test.
 *
 * Reps over 250 ms are non-reactive: they are shown greyed and left out of the
 * average rather than dropped, because a session that drifted slow is the
 * reading. The contact-time band is wider than the height band, and the
 * caption says so, so a 15 ms move is never read as a trend.
 */
export function ReadinessSection({ rows, reps }: ReadinessSectionProps) {
  return (
    <Disclosure
      title="Jump readiness"
      summary={`${rows.length} sessions`}
      testID="progress-readiness"
    >
      {rows.length === 0 ? (
        <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
          No RSI-mode drop-jump tests yet. Log one in RSI mode on a plyometric day and the contact
          time and RSI trends appear here.
        </Text>
      ) : (
        <View style={{ gap: space.md }}>
          <Table
            columns={READINESS_COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            caption="Drop-jump sessions"
            minWidth={READINESS_TABLE_WIDTH}
          />
          {reps.length === 0 ? null : (
            <View style={{ gap: space.xs }}>
              <Text variant="label" color="ink2">
                Latest session, rep by rep
              </Text>
              {reps.map((rep) => (
                <Text
                  key={rep.repNumber}
                  variant="caption"
                  color={rep.reactive ? 'ink' : 'ink3'}
                  numeric
                >
                  {`${rep.repNumber} · ${rep.heightIn} in · ${rep.gctMs} · RSI ${rep.rsi}${
                    rep.reactive ? '' : ' · non-reactive, not counted'
                  }`}
                </Text>
              ))}
            </View>
          )}
          <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
            Contact time carries a wider band than height: the only third-party comparison found
            errors of roughly 10 ms low to 25 ms high. Rolling baselines feed the ladder, never a
            single rep.
          </Text>
        </View>
      )}
    </Disclosure>
  );
}
