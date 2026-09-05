import { scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Circle, Line, Path, Svg } from 'react-native-svg';
import { useTheme } from '../theme';
import { ChartTable } from './chartTable';
import { HoverArea } from './hoverArea';
import {
  AxisLabels,
  AxisMarks,
  ChartFrame,
  Crosshair,
  HitTarget,
  Legend,
  PlotText,
  Tooltip,
  type AxisTick,
  type LegendItem,
} from './parts';
import type { IsoDay, ProbeControl, RecoveryDay, RecoveryMeasure } from './props';
import {
  MARK,
  PLOT_PAD,
  formatDayLong,
  formatDayShort,
  median,
  nearestDay,
  parseDay,
  placeLabels,
  polylinePath,
  recoveryBand,
  rollingMedian,
  segmentByGap,
  toDay,
  type PlacedLabel,
} from './scale';

/** Whoop's own band edges. They are drawn as labelled hairlines, not colour. */
const BAND_EDGES = [33, 66] as const;
const ROLLING_WINDOW = 7;

export interface RecoveryPanelProps extends ProbeControl {
  readonly days: readonly RecoveryDay[];
  readonly programStart: IsoDay;
  readonly targetDate: IsoDay;
  readonly width: number;
  readonly height: number;
  /** Swaps the measure. Recovery is the default; HRV and sleep are the alternates. */
  readonly measure?: RecoveryMeasure;
  /** The owner's own 90-day median, drawn as a labelled grey line. */
  readonly ownerMedian?: number | null;
  readonly showXAxis?: boolean;
  readonly showTable?: boolean;
  /** e.g. "Importing Whoop history · 40/90 days". */
  readonly caption?: string;
}

interface MeasureSpec {
  readonly title: string;
  readonly unit: string;
  readonly banded: boolean;
  readonly format: (value: number) => string;
}

const SPECS: Readonly<Record<RecoveryMeasure, MeasureSpec>> = {
  recovery: {
    title: 'Recovery',
    unit: '%',
    banded: true,
    format: (value) => `${Math.round(value)}%`,
  },
  // Whole milliseconds, on a personal min-max domain: HRV has no absolute scale.
  hrv: { title: 'HRV', unit: 'ms', banded: false, format: (value) => `${Math.round(value)} ms` },
  sleep: {
    title: 'Sleep performance',
    unit: '%',
    banded: false,
    format: (value) => `${Math.round(value)}%`,
  },
};

function valueOf(day: RecoveryDay, measure: RecoveryMeasure): number | null {
  if (measure === 'hrv') return day.hrvMs;
  if (measure === 'sleep') return day.sleepPerformance;
  return day.recovery;
}

/**
 * Daily recovery beside output.
 *
 * A pending day is a gap and never a zero, so the rolling median breaks rather
 * than diving. The band a dot belongs to is carried by its position against the
 * labelled 33 and 66 hairlines first and its colour second: the colour is
 * reinforcement, and the band word is in every tooltip, hit-target label, and
 * table row.
 */
export function RecoveryPanel({
  days,
  programStart,
  targetDate,
  width,
  height,
  measure = 'recovery',
  ownerMedian,
  showXAxis = true,
  showTable = true,
  caption,
  probeDay,
  onProbeChange,
}: RecoveryPanelProps) {
  const { colors, space } = useTheme();
  const spec = SPECS[measure];
  const [ownProbe, setOwnProbe] = useState<IsoDay | null>(null);
  const probe = probeDay !== undefined ? probeDay : ownProbe;
  const setProbe = onProbeChange ?? setOwnProbe;

  const values = useMemo(() => days.map((day) => valueOf(day, measure)), [days, measure]);

  const geometry = useMemo(() => {
    const left = PLOT_PAD.left;
    const right = Math.max(left + 1, width - PLOT_PAD.right);
    const top = PLOT_PAD.top;
    const bottom = Math.max(top + 1, height - PLOT_PAD.bottom);

    const present = values.filter((value): value is number => value !== null);
    // Percent measures keep the full 0 to 100 frame; HRV takes a personal
    // min-max domain, because one athlete's 40 ms is another's 120 ms.
    const domain: readonly [number, number] =
      measure === 'hrv' && present.length > 0
        ? [Math.floor(Math.min(...present) - 5), Math.ceil(Math.max(...present) + 5)]
        : [0, 100];

    const x = scaleLinear()
      .domain([parseDay(programStart), parseDay(targetDate)])
      .range([left, right]);
    const y = scaleLinear().domain([domain[0], domain[1]]).range([bottom, top]);
    return { left, right, top, bottom, domain, px: (d: IsoDay) => x(parseDay(d)), py: y };
  }, [values, measure, programStart, targetDate, width, height]);

  const { left, right, top, bottom, domain, px, py } = geometry;

  const xTicks: readonly AxisTick[] = useMemo(() => {
    const startDay = parseDay(programStart);
    const span = Math.max(1, parseDay(targetDate) - startDay);
    const count = width >= 700 ? 5 : 3;
    return Array.from({ length: count + 1 }, (_, i) => {
      const day = Math.round(startDay + (span * i) / count);
      const iso = toDay(day);
      return { value: day, position: px(iso), text: formatDayShort(iso) };
    });
  }, [programStart, targetDate, width, px]);

  const yTicks: readonly AxisTick[] = useMemo(() => {
    const [lo, hi] = domain;
    const step = (hi - lo) / 2;
    return [lo, lo + step, hi].map((value) => ({
      value: Math.round(value),
      position: py(value),
      text: `${Math.round(value)}`,
    }));
  }, [domain, py]);

  const dots = useMemo(
    () =>
      days
        .map((day, index) => ({ day, value: values[index] ?? null }))
        .filter((entry): entry is { day: RecoveryDay; value: number } => entry.value !== null),
    [days, values],
  );

  // The rolling median keeps pending days as holes, then breaks across them.
  const medianSegments = useMemo(() => {
    const rolled = rollingMedian(values, ROLLING_WINDOW);
    const present = days
      .map((day, index) => ({ date: day.date, value: rolled[index] ?? null }))
      .filter((entry): entry is { date: IsoDay; value: number } => entry.value !== null);
    return segmentByGap(present, (entry) => entry.date, 1);
  }, [days, values]);

  const ownerLevel = ownerMedian ?? median(values);

  /**
   * The right gutter carries the two band edges and the owner's median, and on
   * a 140px panel those three can land within a line-height of each other. They
   * all sit at the same x, so every one of them is a real collision.
   */
  const gutterLabels = useMemo(() => {
    const wanted: PlacedLabel[] = [];
    if (spec.banded) {
      for (const edge of BAND_EDGES) wanted.push({ key: `edge-${edge}`, x: right, y: py(edge) });
    }
    if (ownerLevel !== null) wanted.push({ key: 'owner', x: right, y: py(ownerLevel) });
    return placeLabels(wanted, { minGap: 16, bounds: [top, bottom], xThreshold: 1 });
  }, [spec.banded, ownerLevel, py, right, top, bottom]);

  const probed = useMemo(() => {
    if (probe === null) return null;
    const found = dots.find((entry) => entry.day.date === probe);
    return found === undefined ? null : found;
  }, [probe, dots]);

  const dotDays = useMemo(() => dots.map((entry) => entry.day.date), [dots]);
  const handleProbe = (x: number | null) => {
    setProbe(x === null ? null : nearestDay(x, px, dotDays));
  };

  const bandColor = (value: number): string => {
    if (!spec.banded) return colors.ink2;
    const band = recoveryBand(value);
    if (band === 'low') return colors.data['recovery.low'];
    if (band === 'moderate') return colors.data['recovery.moderate'];
    return colors.data['recovery.high'];
  };

  const legend: LegendItem[] = spec.banded
    ? [
        { glyph: 'dot', label: 'Low', color: colors.data['recovery.low'] },
        { glyph: 'dot', label: 'Moderate', color: colors.data['recovery.moderate'] },
        { glyph: 'dot', label: 'High', color: colors.data['recovery.high'] },
        { glyph: 'line', label: '7-day median', color: colors.ink2 },
        { glyph: 'line', label: '90-day median', color: colors.ink3 },
      ]
    : [
        { glyph: 'dot', label: `Daily ${spec.title.toLowerCase()}`, color: colors.ink2 },
        { glyph: 'line', label: '7-day median', color: colors.ink2 },
        { glyph: 'line', label: '90-day median', color: colors.ink3 },
      ];

  return (
    <ChartFrame title={spec.title} caption={caption}>
      <HoverArea width={width} height={height} onProbe={handleProbe}>
        <Svg width={width} height={height}>
          <AxisMarks
            width={width}
            height={height}
            xTicks={xTicks}
            yTicks={yTicks}
            gridlines={false}
          />

          {spec.banded
            ? BAND_EDGES.map((edge) => (
                <Line
                  key={`edge-${edge}`}
                  x1={left}
                  x2={right}
                  y1={py(edge)}
                  y2={py(edge)}
                  stroke={colors.rule}
                  strokeWidth={1}
                />
              ))
            : null}

          {ownerLevel !== null ? (
            <Line
              x1={left}
              x2={right}
              y1={py(ownerLevel)}
              y2={py(ownerLevel)}
              stroke={colors.ink3}
              strokeWidth={1}
            />
          ) : null}

          {dots.map((entry) => (
            <Circle
              key={`ring-${entry.day.date}`}
              cx={px(entry.day.date)}
              cy={py(entry.value)}
              r={MARK.dotRadius - 1 + MARK.gap}
              fill={colors.paper}
            />
          ))}
          {dots.map((entry) => (
            <Circle
              key={`dot-${entry.day.date}`}
              cx={px(entry.day.date)}
              cy={py(entry.value)}
              r={MARK.dotRadius - 1}
              fill={bandColor(entry.value)}
            />
          ))}

          {medianSegments.map((segment) => (
            <Path
              key={`median-${segment[0]?.date ?? 'x'}`}
              d={polylinePath(segment.map((entry) => [px(entry.date), py(entry.value)]))}
              stroke={colors.ink2}
              strokeWidth={MARK.lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}

          {probed !== null ? (
            <Crosshair x={px(probed.day.date)} top={top} bottom={bottom} />
          ) : null}
        </Svg>

        <View
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
          pointerEvents="box-none"
        >
          <AxisLabels
            width={width}
            height={height}
            xTicks={showXAxis ? xTicks : []}
            yTicks={yTicks}
          />

          {spec.banded
            ? BAND_EDGES.map((edge) => (
                <PlotText
                  key={`edgelab-${edge}`}
                  x={right + 6}
                  y={gutterLabels.get(`edge-${edge}`) ?? py(edge)}
                  width={58}
                  backing
                >
                  {edge === 33 ? '33 low' : '66 high'}
                </PlotText>
              ))
            : null}
          {ownerLevel !== null ? (
            <PlotText
              x={right + 6}
              y={gutterLabels.get('owner') ?? py(ownerLevel)}
              width={58}
              color="ink2"
              backing
            >
              {`${Math.round(ownerLevel)} median`}
            </PlotText>
          ) : null}

          {dots.map((entry) => (
            <HitTarget
              key={`hit-${entry.day.date}`}
              x={px(entry.day.date)}
              y={py(entry.value)}
              label={`${formatDayLong(entry.day.date)}, ${spec.format(entry.value)}${
                spec.banded ? `, ${bandWord(entry.value)}` : ''
              }`}
              onFocus={() => setProbe(entry.day.date)}
              onBlur={() => setProbe(null)}
            />
          ))}

          {probed !== null ? (
            <Tooltip
              x={px(probed.day.date)}
              y={py(probed.value)}
              width={width}
              value={spec.format(probed.value)}
              lines={[
                formatDayLong(probed.day.date),
                ...(spec.banded ? [bandWord(probed.value)] : []),
                'Data by WHOOP',
              ]}
            />
          ) : null}
        </View>
      </HoverArea>

      <View style={{ paddingTop: space.xs }}>
        <Legend items={legend} note="Data by WHOOP" />
      </View>

      {showTable ? (
        <ChartTable
          label={`the ${spec.title.toLowerCase()} table`}
          columns={[
            { key: 'date', header: 'Date' },
            { key: 'value', header: spec.title, numeric: true },
            { key: 'band', header: spec.banded ? 'Band' : 'State' },
          ]}
          rows={days.map((day) => {
            const value = valueOf(day, measure);
            return {
              date: formatDayLong(day.date),
              value: value === null ? 'Pending' : spec.format(value),
              band: value === null ? 'Pending' : spec.banded ? bandWord(value) : 'Recorded',
            };
          })}
        />
      ) : null}
    </ChartFrame>
  );
}

/** Whoop's own vocabulary. Every coloured dot is paired with one of these. */
function bandWord(value: number): string {
  const band = recoveryBand(value);
  if (band === 'low') return 'Low';
  if (band === 'moderate') return 'Moderate';
  return 'High';
}
