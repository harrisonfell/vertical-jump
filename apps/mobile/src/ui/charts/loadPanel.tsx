import { scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Line, Rect, Svg } from 'react-native-svg';
import { useTheme } from '../theme';
import { ChartTable } from './chartTable';
import { HoverArea } from './hoverArea';
import { LABEL_LINE_HEIGHT } from './labelGeometry';
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
} from './parts';
import type { IsoDay, LoadWeek, ProbeControl } from './props';
import { MARK, PLOT_PAD, addDays, formatDayShort, parseDay, toDay } from './scale';

/** Whoop's strain scale tops out at 21. The rug is read against that ceiling. */
const STRAIN_MAX = 21;
/** The rug strip's height: enough for a legible tick, never a second axis. */
const RUG_HEIGHT = 12;
/**
 * From this panel width up, the two weeks before the current one are labelled
 * as well. Narrower than this only the current week carries its number: three
 * labels in a 390pt column would run into each other, and the table twin under
 * the panel already holds every week's load.
 */
const WIDE_LABEL_WIDTH = 834;
/** The most weeks that ever carry a direct sRPE label: this week and two back. */
const MAX_SRPE_LABELS = 3;

export interface LoadPanelProps extends ProbeControl {
  readonly weeks: readonly LoadWeek[];
  /** The stack's shared x domain, so the panels line up day for day. */
  readonly programStart: IsoDay;
  readonly targetDate: IsoDay;
  readonly width: number;
  readonly height: number;
  readonly showXAxis?: boolean;
  readonly showTable?: boolean;
}

/** Thousands-separated whole number, without asking for an Intl runtime. */
export function formatCount(value: number): string {
  const whole = Math.round(value);
  const sign = whole < 0 ? '−' : '';
  return sign + `${Math.abs(whole)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Weekly training load.
 *
 * Sessions done of scheduled is the measure: a filled column inside its full
 * scheduled track, separated by a surface gap rather than a stroke. Done is
 * `ink2` and the track `paper3`, never full ink, so the panel stays evidence for
 * the jump chart above it rather than a second wall of dark columns.
 *
 * The sRPE load rides the done column's top as a direct label, on the weeks
 * close enough to now to act on, and Whoop strain sits in its own rug strip
 * under a hairline, because strain is heart-rate derived evidence and must never
 * share an axis with training load.
 */
export function LoadPanel({
  weeks,
  programStart,
  targetDate,
  width,
  height,
  showXAxis = true,
  showTable = true,
  probeDay,
  onProbeChange,
}: LoadPanelProps) {
  const { colors, space } = useTheme();
  const [ownProbe, setOwnProbe] = useState<IsoDay | null>(null);
  const probe = probeDay !== undefined ? probeDay : ownProbe;
  const setProbe = onProbeChange ?? setOwnProbe;

  const geometry = useMemo(() => {
    const left = PLOT_PAD.left;
    const right = Math.max(left + 1, width - PLOT_PAD.right);
    const top = PLOT_PAD.top;
    const bottom = Math.max(top + 1, height - PLOT_PAD.bottom);
    const rugTop = bottom - RUG_HEIGHT;
    const base = rugTop - 1;

    const x = scaleLinear()
      .domain([parseDay(programStart), parseDay(targetDate)])
      .range([left, right]);
    const px = (day: IsoDay) => x(parseDay(day));

    const maxScheduled = weeks.reduce((max, week) => Math.max(max, week.sessionsScheduled), 1);
    const y = scaleLinear().domain([0, maxScheduled]).range([base, top]);

    // A week's band is seven days wide; the column never fills it.
    const band = Math.max(4, px(addDays(programStart, 7)) - px(programStart));
    const columnWidth = Math.min(MARK.maxColumnWidth, Math.max(4, band - 8));

    return { left, right, top, bottom, rugTop, base, px, y, band, columnWidth };
  }, [weeks, programStart, targetDate, width, height]);

  const { left, right, top, bottom, rugTop, base, px, y, band, columnWidth } = geometry;

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

  const columns = useMemo(
    () =>
      weeks.map((week) => {
        const centre = px(week.weekStart) + band / 2;
        return {
          week,
          centre,
          x: centre - columnWidth / 2,
          topScheduled: y(week.sessionsScheduled),
          topDone: y(week.sessionsDone),
        };
      }),
    [weeks, px, band, columnWidth, y],
  );

  const probedWeek = useMemo(() => {
    if (probe === null) return null;
    const day = parseDay(probe);
    return (
      columns.find((column) => {
        const start = parseDay(column.week.weekStart);
        return day >= start && day < start + 7;
      }) ?? null
    );
  }, [probe, columns]);

  const handleProbe = (x: number | null) => {
    if (x === null) {
      setProbe(null);
      return;
    }
    let best: (typeof columns)[number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const column of columns) {
      const distance = Math.abs(column.centre - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = column;
      }
    }
    setProbe(best === null ? null : best.week.weekStart);
  };

  /**
   * The current week is the last one with anything logged against it; the weeks
   * after it are scheduled and have no load to state yet. Labelling from there
   * backwards keeps the number on the weeks the athlete can still act on.
   */
  const labelled = useMemo(() => {
    let current = -1;
    for (let i = 0; i < weeks.length; i += 1) {
      const week = weeks[i];
      if (week !== undefined && (week.sessionsDone > 0 || week.srpeLoad > 0)) current = i;
    }
    if (current < 0) return new Set<string>();
    const count = width >= WIDE_LABEL_WIDTH ? MAX_SRPE_LABELS : 1;
    const keys = new Set<string>();
    for (let i = current; i > current - count && i >= 0; i -= 1) {
      const week = weeks[i];
      if (week !== undefined && week.srpeLoad > 0) keys.add(week.weekStart);
    }
    return keys;
  }, [weeks, width]);

  return (
    <ChartFrame title="Weekly load">
      <HoverArea width={width} height={height} onProbe={handleProbe}>
        <Svg width={width} height={height}>
          <AxisMarks width={width} height={height} xTicks={xTicks} gridlines={false} />
          {/* The rug's own rule: strain lives below it, load above. */}
          <Line x1={left} x2={right} y1={rugTop} y2={rugTop} stroke={colors.rule} strokeWidth={1} />

          {columns.map((column) => (
            <Rect
              key={`track-${column.week.weekStart}`}
              x={column.x}
              y={column.topScheduled}
              width={columnWidth}
              height={Math.max(0, base - column.topScheduled)}
              fill={colors.paper3}
            />
          ))}
          {columns.map((column) =>
            column.week.sessionsDone > 0 ? (
              <Rect
                key={`done-${column.week.weekStart}`}
                x={column.x}
                y={column.topDone}
                width={columnWidth}
                height={Math.max(0, base - column.topDone)}
                fill={colors.ink2}
              />
            ) : null,
          )}
          {/* The 2px surface gap that separates done from still-scheduled. */}
          {columns.map((column) =>
            column.week.sessionsDone > 0 &&
            column.week.sessionsDone < column.week.sessionsScheduled ? (
              <Rect
                key={`gap-${column.week.weekStart}`}
                x={column.x}
                y={column.topDone - MARK.gap}
                width={columnWidth}
                height={MARK.gap}
                fill={colors.paper}
              />
            ) : null,
          )}

          {probedWeek !== null ? (
            <Crosshair x={probedWeek.centre} top={top} bottom={base} />
          ) : null}

          {columns.map((column) =>
            column.week.strains.map((strain, index) => {
              const count = Math.max(1, column.week.strains.length);
              const slot = columnWidth / count;
              const tickX = column.x + slot * index + slot / 2;
              const tickHeight = Math.max(
                2,
                (Math.min(strain, STRAIN_MAX) / STRAIN_MAX) * (RUG_HEIGHT - 2),
              );
              return (
                <Rect
                  key={`strain-${column.week.weekStart}-${index}`}
                  x={tickX - 1}
                  y={bottom - tickHeight}
                  width={2}
                  height={tickHeight}
                  fill={colors.ink3}
                />
              );
            }),
          )}
        </Svg>

        <View
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
          pointerEvents="box-none"
        >
          <AxisLabels width={width} height={height} xTicks={showXAxis ? xTicks : []} />

          {/* The week's load, on top of its own done column, on a paper backing
              so it stays legible where the column beside it is taller. */}
          {columns
            .filter((column) => labelled.has(column.week.weekStart))
            .map((column) => (
              <PlotText
                key={`srpe-${column.week.weekStart}`}
                x={column.centre}
                y={Math.max(LABEL_LINE_HEIGHT, column.topDone - 4)}
                anchor="middle"
                vertical="bottom"
                color="ink"
                width={Math.max(band, 44)}
                backing
              >
                {formatCount(column.week.srpeLoad)}
              </PlotText>
            ))}

          {columns.map((column) => (
            <HitTarget
              key={`hit-${column.week.weekStart}`}
              x={column.centre}
              y={(top + base) / 2}
              size={Math.max(MARK.hitSize, band)}
              label={`Week ${column.week.weekNumber}, ${column.week.sessionsDone} of ${column.week.sessionsScheduled} sessions, ${formatCount(column.week.srpeLoad)} sRPE`}
              onFocus={() => setProbe(column.week.weekStart)}
              onBlur={() => setProbe(null)}
            />
          ))}

          {probedWeek !== null ? (
            <Tooltip
              x={probedWeek.centre}
              y={top}
              width={width}
              value={`${probedWeek.week.sessionsDone} of ${probedWeek.week.sessionsScheduled} sessions`}
              lines={[
                `Week ${probedWeek.week.weekNumber}`,
                `${formatCount(probedWeek.week.srpeLoad)} sRPE`,
                probedWeek.week.strains.length > 0
                  ? `Strain ${probedWeek.week.strains.map((s) => s.toFixed(1)).join(', ')}`
                  : 'No matched workouts',
              ]}
            />
          ) : null}
        </View>
      </HoverArea>

      <View style={{ paddingTop: space.xs }}>
        <Legend
          items={[
            { glyph: 'column', label: 'Sessions done', color: colors.ink2 },
            { glyph: 'column', label: 'Scheduled', color: colors.paper3 },
            { glyph: 'tick', label: 'Whoop strain per session', color: colors.ink3 },
          ]}
          note="Data by WHOOP"
        />
      </View>

      {showTable ? (
        <ChartTable
          label="the load table"
          columns={[
            { key: 'week', header: 'Week', numeric: true, width: 56 },
            { key: 'sessions', header: 'Sessions', numeric: true },
            { key: 'srpe', header: 'sRPE', numeric: true },
            { key: 'strain', header: 'Strain' },
          ]}
          rows={weeks.map((week) => ({
            week: `${week.weekNumber}`,
            sessions: `${week.sessionsDone}/${week.sessionsScheduled}`,
            srpe: formatCount(week.srpeLoad),
            strain:
              week.strains.length > 0
                ? week.strains.map((s) => s.toFixed(1)).join(', ')
                : 'No match',
          }))}
        />
      ) : null}
    </ChartFrame>
  );
}
