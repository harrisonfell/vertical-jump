import { View } from 'react-native';
import { Disclosure, Glyph, Hairline, Table, Text, space, useTheme, type TableColumn } from '@/ui';
import { useChartSize } from '@/ui/charts';
import { NO_VALUE } from './derive';
import { ChannelStrip } from './channelStrip';
import { PullUpChart } from './pullUpChart';
import type {
  AsymmetryModel,
  AsymmetryRow,
  PullUpModel,
  ReadinessGateDay,
  ReadinessGateModel,
  TopSetRow,
} from './types';

/**
 * The three sections the climbing house rules add to Progress.
 *
 * Each one is a headed disclosure that says how much is in it before it is
 * opened, and each one leads with numbers rather than with a shape: the
 * asymmetry table is the reading and the band words are the interpretation,
 * the readiness strip is a picture of two channels whose every day is also a
 * table row, and the pull-up chart carries its own table twin.
 */

/* ---------------------------------------------------- pull-up strength */

const TOP_SET_COLUMNS: readonly TableColumn<TopSetRow>[] = [
  { key: 'date', header: 'Date', width: 72, render: (row) => row.dateLabel },
  { key: 'set', header: 'Top set', numeric: true, render: (row) => row.setLabel },
  { key: 'rpe', header: 'Effort', width: 72, render: (row) => row.rpe },
];

export interface PullUpSectionProps {
  readonly model: PullUpModel | null;
}

/**
 * Pull-up strength: the added-load working max, where it came from, the trend
 * over weeks, and the sets behind it. The correlate sentence is said once,
 * under the number it explains.
 */
export function PullUpSection({ model }: PullUpSectionProps) {
  const { width, onLayout } = useChartSize();
  if (model === null) return null;

  return (
    <Disclosure
      title="Pull-up strength"
      summary={`${model.topSets.length} sessions`}
      testID="progress-pull-up"
    >
      <View style={{ gap: space.sm }} onLayout={onLayout}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
          <Text variant="title" color="ink" style={{ flex: 1 }}>
            {model.name}
          </Text>
          <Text
            variant="title"
            color={model.workingMaxLb === null ? 'ink3' : 'ink'}
            numeric={model.workingMaxLb !== null}
          >
            {model.workingMaxLb ?? NO_VALUE}
          </Text>
        </View>
        <Text variant="caption" color="ink2" numeric>
          {model.sourceLine}
        </Text>
        {model.dropLine === null ? null : (
          <Text variant="caption" color="ink2" numeric>
            {model.dropLine}
          </Text>
        )}
        <Text variant="body" color="ink" style={{ maxWidth: 560 }}>
          {model.correlateLine}
        </Text>

        <PullUpChart points={model.trend} width={width} caption={model.trendCaption} />

        <Disclosure title="Top-set history" summary={`${model.topSets.length} sessions`}>
          <Table
            columns={TOP_SET_COLUMNS}
            rows={model.topSets}
            rowKey={(row) => `${model.exerciseId}-${row.date}`}
            caption={`${model.name} top sets`}
            minWidth={360}
            emptyText="No weighted pull-up sets logged yet."
          />
          <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
            Added load only. Your bodyweight is not on the bar, so it is never in the max.
          </Text>
        </Disclosure>
        <Hairline />
      </View>
    </Disclosure>
  );
}

/* ----------------------------------------------------------- asymmetry */

const ASYMMETRY_COLUMNS: readonly TableColumn<AsymmetryRow>[] = [
  { key: 'date', header: 'Date', width: 72, render: (row) => row.dateLabel },
  { key: 'left', header: 'Left', width: 64, numeric: true, render: (row) => row.leftIn },
  { key: 'right', header: 'Right', width: 64, numeric: true, render: (row) => row.rightIn },
  { key: 'gap', header: 'Gap', width: 64, numeric: true, render: (row) => row.pct },
  { key: 'weaker', header: 'Weaker', width: 72, render: (row) => row.weakerSide },
];

/** The five widths plus their four gaps, so the last column is never clipped. */
const ASYMMETRY_TABLE_WIDTH = 72 + 64 + 64 + 64 + 72 + 4 * space.md;

export interface AsymmetrySectionProps {
  readonly model: AsymmetryModel | null;
}

/**
 * Asymmetry, hidden until one single-leg test exists.
 *
 * A single-leg jump is its own mode: it never joins the jump stream, the
 * trend, the pace, or a PR, so nothing here reaches the one big number. The
 * gap is signed left-minus-right as a share of the better leg, and the weaker
 * side is named in words beside it rather than left to a minus sign.
 */
export function AsymmetrySection({ model }: AsymmetrySectionProps) {
  if (model === null) return null;

  return (
    <Disclosure
      title="Asymmetry"
      summary={`${model.rows.length} ${model.rows.length === 1 ? 'test' : 'tests'}`}
      testID="progress-asymmetry"
    >
      <View style={{ gap: space.sm }}>
        <Text variant="body" color="ink" numeric style={{ maxWidth: 560 }}>
          {model.latestLine}
        </Text>
        <Text variant="caption" color="ink2" style={{ maxWidth: 560 }}>
          {model.note}
        </Text>
        <Text variant="caption" color="ink3" numeric style={{ maxWidth: 560 }}>
          {model.legend}
        </Text>

        <Table
          columns={ASYMMETRY_COLUMNS}
          rows={model.rows}
          rowKey={(row) => row.id}
          caption="Single-leg tests"
          minWidth={ASYMMETRY_TABLE_WIDTH}
        />
        <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
          Gap is signed: a plus means the left leg jumped higher, so the right one is the weaker
          side. Single-leg tests are never canonical and never set a personal record.
        </Text>

        {model.trendLine === null ? null : (
          <Text variant="caption" color="ink2" numeric style={{ maxWidth: 560 }}>
            {model.trendLine}
          </Text>
        )}
        {model.effortLine === null ? null : (
          <Text variant="caption" color="ink2" numeric style={{ maxWidth: 560 }}>
            {model.effortLine}
          </Text>
        )}
        <Text variant="caption" color="ink2" style={{ maxWidth: 560 }}>
          {model.orderLine}
        </Text>
      </View>
    </Disclosure>
  );
}

/* ------------------------------------------------------------ readiness */

const GATE_COLUMNS: readonly TableColumn<ReadinessGateDay>[] = [
  { key: 'date', header: 'Date', width: 72, render: (row) => row.dateLabel },
  {
    key: 'recovery',
    header: 'Recovery',
    width: 88,
    numeric: true,
    render: (row) =>
      row.recoveryScore === null
        ? 'No score'
        : `${row.recoveryScore}% ${bandWord(row.recoveryBand)}`,
  },
  {
    key: 'output',
    header: 'Output',
    width: 80,
    numeric: true,
    render: (row) => row.testValue ?? 'No test',
  },
  { key: 'state', header: 'Reading', width: 96, render: (row) => stateWord(row.state) },
];

/** The four widths plus their three gaps. */
const GATE_TABLE_WIDTH = 72 + 88 + 80 + 96 + 3 * space.md;

/** Whoop's own band vocabulary, kept verbatim. */
function bandWord(band: 'low' | 'moderate' | 'high' | null): string {
  if (band === 'low') return 'Low';
  if (band === 'moderate') return 'Moderate';
  if (band === 'high') return 'High';
  return '';
}

/** One day's reading in three words, so the table never needs the strip. */
function stateWord(state: ReadinessGateDay['state']): string {
  switch (state) {
    case 'both_high':
      return 'Both high';
    case 'autonomic_low':
      return 'Autonomic low';
    case 'neuromuscular_low':
      return 'Neuro low';
    case 'both_low':
      return 'Both low';
    case 'unknown':
      return 'Not scored';
  }
}

export interface ReadinessGateSectionProps {
  readonly model: ReadinessGateModel | null;
}

/**
 * The readiness gate over the last 30 days.
 *
 * Two channels, never averaged: the strip draws them as two rows aligned by
 * date, the table under it carries the same days as numbers, and the four
 * states are spelled out in words with the magnitudes the ruleset actually
 * applies. Divergence between the channels is the signal, so it is counted in
 * the summary line and marked on its own row of ticks.
 */
export function ReadinessGateSection({ model }: ReadinessGateSectionProps) {
  const { colors } = useTheme();
  const { width, onLayout } = useChartSize();
  if (model === null) return null;

  return (
    <Disclosure
      title="Readiness"
      summary={`${model.days.length} days`}
      testID="progress-readiness-gate"
    >
      <View style={{ gap: space.md }} onLayout={onLayout}>
        <Text variant="caption" color="ink2" numeric>
          {`${model.fromLabel} to ${model.toLabel} · Data by WHOOP`}
        </Text>

        <ChannelStrip days={model.days} width={width} testNoun={model.testNoun} />

        <Text variant="body" color="ink" numeric style={{ maxWidth: 560 }}>
          {model.divergenceLine}
        </Text>
        {model.todayLine === null ? null : (
          <Text variant="caption" color="ink2" numeric style={{ maxWidth: 560 }}>
            {model.todayLine}
          </Text>
        )}

        <View style={{ gap: space.xs }}>
          <Text variant="label" color="ink2">
            The four readings
          </Text>
          {model.legend.map((item) => (
            <View
              key={item.state}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}
            >
              {item.diverged ? (
                <Glyph name="flag" color={colors.ink2} size={16} />
              ) : (
                <View style={{ width: 16 }} />
              )}
              <Text variant="caption" color="ink2" numeric style={{ flex: 1, maxWidth: 560 }}>
                {`${item.title}${item.diverged ? ' · Divergence' : ''}. ${item.line}`}
              </Text>
            </View>
          ))}
        </View>

        <Table
          columns={GATE_COLUMNS}
          rows={[...model.days].reverse()}
          rowKey={(row) => row.date}
          caption="Readiness by day"
          minWidth={GATE_TABLE_WIDTH}
        />
      </View>
    </Disclosure>
  );
}
