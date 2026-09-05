import { formatHeightIn, formatPercentDelta, inToMm } from '@vert/engine/units';
import { View } from 'react-native';
import { Glyph, glyphNames } from '../glyphs';
import { Button, ButtonRow } from '../primitives/button';
import { Chip } from '../primitives/chip';
import { Disclosure } from '../primitives/disclosure';
import { EmptyState } from '../primitives/emptyState';
import { Table, type TableColumn } from '../primitives/table';
import { Sheet, useSheet } from '../sheet';
import { Skeleton } from '../skeleton';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { KitCase, KitSection } from './kitSection';

const noop = (): void => undefined;

interface WeekRow {
  readonly week: number;
  readonly sessions: string;
  readonly percent: string;
  readonly reps: string;
  readonly outcome: string;
}

const WEEKS: readonly WeekRow[] = [
  { week: 7, sessions: '3 of 3', percent: '100%', reps: 'all made', outcome: 'progressed' },
  { week: 6, sessions: '2 of 3', percent: '67%', reps: 'all made', outcome: 'repeat' },
  { week: 5, sessions: '3 of 3', percent: '100%', reps: '2 missed', outcome: 'hold' },
  { week: 4, sessions: '3 of 3', percent: '100%', reps: 'all made', outcome: 'progressed' },
];

const WEEK_COLUMNS: readonly TableColumn<WeekRow>[] = [
  { key: 'week', header: 'Week', width: 56, numeric: true, render: (row) => String(row.week) },
  { key: 'sessions', header: 'Sessions', width: 88, render: (row) => row.sessions },
  { key: 'percent', header: 'Done', width: 64, numeric: true, render: (row) => row.percent },
  { key: 'reps', header: 'Reps', width: 88, render: (row) => row.reps },
  { key: 'outcome', header: 'Outcome', render: (row) => row.outcome },
];

/** Sheet, skeletons, tables, disclosures, empty states, and the glyph set. */
export function KitSurfaces() {
  const finish = useSheet();

  return (
    <View style={{ gap: space.lg }}>
      <KitSection title="Sheet" note="Slides up in 250 ms. Escape, the backdrop, or Close dismiss it.">
        <Button label="Open the finish sheet" variant="secondary" onPress={finish.show} />
        <Sheet
          visible={finish.open}
          onClose={finish.hide}
          title="Finish session"
          subtitle="Week 7 of 12 · Full Body Strength"
          actions={
            <Button label="Finish session" variant="primary" size={56} fullWidth onPress={finish.hide} />
          }
        >
          <Text variant="body" color="ink2">
            18 of 22 sets logged. Finishing now records the session as it stands; sets stay
            editable for 7 days.
          </Text>
          <View style={{ gap: space.sm }}>
            <Text variant="label" color="ink2">
              Session RPE
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {[6, 7, 8, 9, 10].map((value) => (
                <Chip key={value} label={String(value)} accessibilityLabel={`Session RPE ${value}`} />
              ))}
            </View>
          </View>
        </Sheet>
      </KitSection>

      <KitSection title="Skeleton" note="Blocks sized to the real layout, breathing on opacity only.">
        <KitCase label="header, strip, three set rows">
          <View style={{ gap: space.sm }}>
            <Skeleton skeletonFor="header" />
            <Skeleton skeletonFor="strip" />
            <Skeleton skeletonFor="setRow" count={3} />
          </View>
        </KitCase>
        <KitCase label="chart panel and single lines">
          <View style={{ gap: space.md }}>
            <Skeleton skeletonFor="chartPanel" />
            <Skeleton skeletonFor="line" count={2} />
          </View>
        </KitCase>
      </KitSection>

      <KitSection title="Table" note="The chart twin and the Weeks table. Numbers right, tabular.">
        <Table
          caption="Weeks"
          columns={WEEK_COLUMNS}
          rows={WEEKS}
          rowKey={(row) => String(row.week)}
          minWidth={420}
        />
        <Table
          caption="Test ledger"
          columns={WEEK_COLUMNS}
          rows={[]}
          rowKey={(row) => String(row.week)}
          emptyText="No tests yet. First test: Sat 13 Sep."
        />
      </KitSection>

      <KitSection title="Disclosure" note="The chevron turns; nothing else moves.">
        <Disclosure title="Rules summary" summary="9 rules">
          <Text variant="body" color="ink2">
            No maximal jumps the day after a heavy squat session (rule 91).
          </Text>
          <Text variant="body" color="ink2">
            Hip pain: house rule, no rule-book rule exists.
          </Text>
        </Disclosure>
        <Disclosure title="Earlier weeks" summary="weeks 1 to 6" defaultOpen>
          <Text variant="body" color="ink2">
            {`Week 6 · 2 of 3 (67%) · repeat · test ${formatHeightIn(inToMm(31.8))} · trend ${formatPercentDelta(
              4,
            )} of the pace needed`}
          </Text>
        </Disclosure>
      </KitSection>

      <KitSection title="EmptyState" note="One paragraph that teaches, one 44px action.">
        <EmptyState
          body="No program yet. Setup takes about three minutes and asks for your training age, the days you can train, and a goal height with a date."
          actionLabel="Build program"
          onAction={noop}
        />
      </KitSection>

      <KitSection title="Glyphs" note="20px grid, 1.5px stroke, currentColor. Every one carries a word.">
        <GlyphGrid />
      </KitSection>

      <KitSection title="Focus" note="Tab through this page on the web to see the ring.">
        <ButtonRow>
          <Button label="First" variant="secondary" onPress={noop} />
          <Button label="Second" variant="secondary" onPress={noop} />
          <Button label="Third" variant="secondary" onPress={noop} />
        </ButtonRow>
      </KitSection>
    </View>
  );
}

function GlyphGrid() {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      {glyphNames().map((name) => (
        <View key={name} style={{ width: 108, gap: space.xs, alignItems: 'center' }}>
          <View
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.rule,
            }}
          >
            <Glyph name={name} color={colors.ink} />
          </View>
          <Text variant="caption" color="ink3" align="center">
            {name}
          </Text>
        </View>
      ))}
    </View>
  );
}
