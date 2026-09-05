import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ariaState, selectionState } from '@/ui/a11y';
import { Hairline } from '@/ui/primitives/hairline';
import { CONTENT_WIDTH, gutterFor } from '@/ui/primitives/screen';
import { Text } from '@/ui/text';
import { ThemeProvider, breakpoint, space, useTheme } from '@/ui/theme';
import type { SchemeName } from '@/ui/tokens.generated';
import {
  JumpChart,
  LoadPanel,
  LoadVelocityChart,
  RecoveryPanel,
  Sparkline,
  ThreePanel,
  panelHeights,
  type JumpChartData,
  type RecoveryMeasure,
} from '@/ui/charts';
import {
  GOAL_IN,
  NINETY_START,
  PROGRAM_START,
  TARGET_DATE,
  TODAY,
  earlyTrend,
  goalMet,
  loadWeeks,
  ninetyDayRecovery,
  noTests,
  plateau,
  programRecovery,
  sparklineValues,
  twoTests,
  velocityFit,
  velocityPoints,
  withGap,
  withHollowMarks,
  withProjection,
  withStreamBreak,
} from '@/ui/charts/sampleData';

const WIDTHS = [390, 834, 1280] as const;
const SCHEMES: readonly SchemeName[] = ['light', 'dark'];
const MEASURES: readonly RecoveryMeasure[] = ['recovery', 'hrv', 'sleep'];

type Width = (typeof WIDTHS)[number];

/**
 * The width a chart actually gets on a product screen at this viewport.
 *
 * The preset names a viewport, not a chart: drawing a 390px chart inside a
 * 390px viewport is 32px wider than any screen ever asks for, so the goal
 * label and the last x tick fell off the right edge in the gallery and
 * nowhere else. Screens measure their container through `useChartSize`; the
 * gallery has no container to measure, so it reproduces the same arithmetic:
 * the screen gutter, the content measure, and, at desktop width, the left
 * column of Progress's two-column layout.
 */
function chartWidthFor(viewport: number): number {
  const gutter = gutterFor(viewport);
  const desktop = viewport >= breakpoint.desktop;
  const measure = Math.min(viewport, desktop ? CONTENT_WIDTH.wide : CONTENT_WIDTH.narrow);
  const content = measure - gutter * 2;
  if (!desktop) return content;
  return Math.round(((content - space.xl) * 3) / 5);
}

/**
 * The chart gallery.
 *
 * A development route, not a product surface: every chart and every state the
 * brief names, at the three composition widths, in both schemes, from one place
 * so a regression is visible in one scroll. The controls sit in a single row
 * above everything they scope.
 */
export default function ChartGallery() {
  const insets = useSafeAreaInsets();
  // Deep-linkable so a QA pass can capture one exact state:
  // /dev/charts?width=834&scheme=dark&measure=hrv
  const params = useLocalSearchParams<{
    width?: string;
    scheme?: string;
    measure?: string;
  }>();
  const [width, setWidth] = useState<Width>(
    WIDTHS.find((value) => `${value}` === params.width) ?? 390,
  );
  const [scheme, setScheme] = useState<SchemeName>(params.scheme === 'dark' ? 'dark' : 'light');
  const [measure, setMeasure] = useState<RecoveryMeasure>(
    MEASURES.find((value) => value === params.measure) ?? 'recovery',
  );
  const plot = chartWidthFor(width);

  return (
    <ThemeProvider override={scheme}>
      <Ground>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + space.lg,
            paddingBottom: space.xxxl,
            paddingHorizontal: space.lg,
            gap: space.lg,
          }}
        >
          <View style={{ gap: space.xs }}>
            <Text variant="headline">Charts</Text>
            <Text variant="caption" color="ink2">
              {`Sample data only. Program ${PROGRAM_START} to ${TARGET_DATE}, today ${TODAY}, goal ${GOAL_IN.toFixed(1)} in.`}
            </Text>
          </View>

          <View style={{ gap: space.sm }}>
            <Choices
              label="Width"
              options={WIDTHS.map((value) => `${value}`)}
              value={`${width}`}
              onChange={(next) => setWidth(Number(next) as Width)}
            />
            <Choices
              label="Scheme"
              options={SCHEMES}
              value={scheme}
              onChange={(next) => setScheme(next as SchemeName)}
            />
            <Choices
              label="Recovery measure"
              options={MEASURES}
              value={measure}
              onChange={(next) => setMeasure(next as RecoveryMeasure)}
            />
          </View>

          <Hairline strong />

          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View
              style={{
                width,
                paddingHorizontal: gutterFor(width),
                gap: space.xl,
                paddingBottom: space.lg,
              }}
            >
              <Section
                title="0 tests"
                note="The frame stands on its own: baseline open marker, goal point, required pace."
              >
                <Jump data={noTests} width={plot} />
              </Section>

              <Section title="1 to 2 tests" note="Dots, no trend line. Trend needs 4 tests.">
                <Jump data={twoTests} width={plot} />
              </Section>

              <Section title="3 to 5 tests" note="The early trend segment over the observed range.">
                <Jump data={earlyTrend} width={plot} />
              </Section>

              <Section
                title="6+ tests"
                note="The dashed projection and its band reach the target date."
              >
                <Jump data={withProjection} width={plot} />
              </Section>

              <Section
                title="Flagged and non-canonical"
                note="Hollow markers, both excluded from the trend."
              >
                <Jump data={withHollowMarks} width={plot} />
              </Section>

              <Section
                title="Goal met"
                note="Two tests at or above the goal. The projection is hidden."
              >
                <Jump data={goalMet} width={plot} />
              </Section>

              <Section
                title="Plateau"
                note="Five tests inside half an inch. The frame does not flatter it."
              >
                <Jump data={plateau} width={plot} />
              </Section>

              <Section title="Gap over 21 days" note="A 35-day gap. The observed path breaks.">
                <Jump data={withGap} width={plot} />
              </Section>

              <Section
                title="Stream break"
                note="A device version change, labelled. No PR is ever taken across it."
              >
                <Jump data={withStreamBreak} width={plot} />
              </Section>

              <Section title="Sparkline" note="Six points beside the one big number. No axes.">
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
                  <Text variant="headline" numeric>
                    32.5
                  </Text>
                  <Sparkline
                    values={sparklineValues}
                    label="Six tests, 29.6 to 32.5 inches, rising"
                  />
                </View>
              </Section>

              <Section title="Weekly load" note="Sessions done of scheduled, sRPE, strain rug.">
                <LoadPanel
                  weeks={loadWeeks}
                  programStart={PROGRAM_START}
                  targetDate={TARGET_DATE}
                  width={plot}
                  height={panelHeights(plot).load}
                />
              </Section>

              <Section
                title="Recovery, 90 days"
                note={`Pending days are gaps, never zeros. Window ${NINETY_START} to ${TODAY}.`}
              >
                <RecoveryPanel
                  days={ninetyDayRecovery}
                  programStart={NINETY_START}
                  targetDate={TODAY}
                  width={plot}
                  height={panelHeights(plot).recovery}
                  measure={measure}
                  caption="Importing Whoop history · 78/90 days"
                />
              </Section>

              <Section
                title="Three panels, one linked crosshair"
                note="Output, load, and recovery on the shared program window."
              >
                <ThreePanel
                  jump={withProjection}
                  weeks={loadWeeks}
                  days={programRecovery}
                  width={plot}
                  measure={measure}
                  recoveryCaption="Importing Whoop history · 43/83 days"
                />
              </Section>

              <Section title="Load and velocity" note="Points, a fitted line, n and r squared.">
                <LoadVelocityChart
                  points={velocityPoints}
                  fit={velocityFit}
                  width={plot}
                  lift="Back squat"
                />
              </Section>
            </View>
          </ScrollView>
        </ScrollView>
      </Ground>
    </ThemeProvider>
  );
}

function Ground({ children }: { readonly children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.paper }}>{children}</View>;
}

function Jump({ data, width }: { readonly data: JumpChartData; readonly width: number }) {
  return <JumpChart data={data} width={width} height={panelHeights(width).jump} />;
}

function Section({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Hairline />
      <Text variant="title">{title}</Text>
      <Text variant="caption" color="ink2">
        {note}
      </Text>
      {children}
    </View>
  );
}

function Choices({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Text variant="label" color="ink3" style={{ width: 130 }}>
        {label}
      </Text>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            focusable
            accessibilityRole="radio"
            accessibilityState={selectionState('radio', selected, false)}
            {...ariaState(selectionState('radio', selected, false))}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              minHeight: 44,
              minWidth: 44,
              paddingHorizontal: space.md,
              justifyContent: 'center',
              backgroundColor: selected
                ? colors.greenSoft
                : pressed
                  ? colors.paper3
                  : colors.paper2,
            })}
          >
            <Text variant="caption" color={selected ? 'ink' : 'ink2'}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
