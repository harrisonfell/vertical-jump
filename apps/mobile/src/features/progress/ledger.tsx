import { View } from 'react-native';
import {
  formatInDelta,
  formatInValue,
  formatPercentWhole,
  type RecoveryOutputRow,
  type RecoveryOutputTable,
} from '@vert/engine/analytics';
import { Button, Disclosure, Hairline, Table, Text, space, type TableColumn } from '@/ui';
import { useChartSize } from '@/ui/charts';
import { DotStrips } from './dotStrip';
import { NO_VALUE } from './derive';
import type { LedgerRow, RecoveryDotBand } from './types';

const OUTPUT_COLUMNS: readonly TableColumn<RecoveryOutputRow>[] = [
  { key: 'band', header: 'Recovery', width: 88, render: (row) => row.label },
  { key: 'sessions', header: 'Sessions', width: 72, numeric: true, render: (row) => `${row.sessions}` },
  {
    key: 'rpe',
    header: 'Median RPE',
    width: 96,
    numeric: true,
    render: (row) => (row.medianRpe === null ? '' : formatInValue(row.medianRpe)),
  },
  {
    key: 'heavy',
    header: 'Heavy legs',
    width: 88,
    numeric: true,
    render: (row) =>
      row.heavyLegsFraction === null ? '' : formatPercentWhole(row.heavyLegsFraction),
  },
  { key: 'tests', header: 'Tests', width: 56, numeric: true, render: (row) => `${row.tests}` },
  {
    key: 'residual',
    header: 'Median residual',
    width: 112,
    numeric: true,
    render: (row) => (row.medianResidualIn === null ? '' : `${formatInDelta(row.medianResidualIn)} in`),
  },
];

export interface RecoveryOutputSectionProps {
  readonly table: RecoveryOutputTable;
  readonly bands: readonly RecoveryDotBand[];
}

/**
 * Recovery beside output, collapsed to its counter until one band has six
 * sessions. A two-session band would invite a conclusion the data cannot
 * carry, so the section says how far off it is instead of drawing one.
 */
export function RecoveryOutputSection({ table, bands }: RecoveryOutputSectionProps) {
  const { width, onLayout } = useChartSize();

  return (
    <Disclosure
      title="Recovery vs output"
      summary={table.ready ? 'ready' : 'collecting'}
      testID="progress-recovery-output"
    >
      <View style={{ gap: space.md }} onLayout={onLayout}>
        {table.ready ? (
          <>
            <Table
              columns={OUTPUT_COLUMNS}
              rows={table.rows}
              rowKey={(row) => row.band}
              caption="Recovery vs output"
              minWidth={520}
            />
            <DotStrips bands={bands} width={width} />
            <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
              Rule-book adjustments for soreness and pain are logged separately from the shadow
              modifier, so nothing here is an adjustment the app already made. Data by WHOOP.
            </Text>
          </>
        ) : (
          <Text variant="body" color="ink2" style={{ maxWidth: 560 }} numeric>
            {table.counterLine ?? ''}
          </Text>
        )}
      </View>
    </Disclosure>
  );
}

export interface LedgerSectionProps {
  readonly rows: readonly LedgerRow[];
  readonly deletedId: string | null;
  readonly deletedLabel: string | null;
  readonly onEdit: (row: LedgerRow) => void;
  readonly onDelete: (row: LedgerRow) => void;
  readonly onUndo: () => void;
}

/**
 * Every test, newest first, with the flags that decide what it counts for.
 *
 * A delete happens at once and the stream recomputes; the row it leaves
 * behind is an undo line, not a confirmation dialog, because the destructive
 * step is reversible and a sheet in front of a list of twelve rows is worse
 * than the mistake it prevents.
 */
export function LedgerSection({
  rows,
  deletedId,
  deletedLabel,
  onEdit,
  onDelete,
  onUndo,
}: LedgerSectionProps) {
  return (
    <Disclosure title="Test ledger" summary={`${rows.length} tests`} testID="progress-ledger">
      <View>
        {rows.length === 0 ? (
          <Text variant="caption" color="ink3">
            No tests logged yet.
          </Text>
        ) : null}
        {rows.map((row) => (
          <View key={row.id}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                minHeight: 44,
                paddingVertical: space.sm,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="body" color="ink" numeric>
                  {`${row.bestIn === '' ? NO_VALUE : `${row.bestIn} in`} · ${row.dateLabel}`}
                </Text>
                <Text variant="caption" color="ink2" numeric>
                  {ledgerDetail(row)}
                </Text>
              </View>
              <Button
                label="Edit"
                variant="quiet"
                accessibilityLabel={`Edit the ${row.dateLabel} test`}
                onPress={() => onEdit(row)}
              />
              <Button
                label="Delete"
                variant="destructive"
                accessibilityLabel={`Delete the ${row.dateLabel} test`}
                onPress={() => onDelete(row)}
              />
            </View>
            <Hairline />
          </View>
        ))}

        {deletedId === null ? null : (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: 44,
              paddingVertical: space.sm,
            }}
          >
            <Text variant="body" color="ink" style={{ flex: 1 }}>
              {`Deleted the ${deletedLabel ?? 'last'} test. The stream recomputed.`}
            </Text>
            <Button label="Undo" variant="secondary" onPress={onUndo} />
          </View>
        )}
      </View>
    </Disclosure>
  );
}

/** "OVR Jump · Regular · 5 attempts · 1 flagged · spread 0.7 in · PR". */
function ledgerDetail(row: LedgerRow): string {
  const parts = [`${row.instrumentLabel} · ${row.mode}`, `${row.attempts} attempts`];
  if (row.flagged > 0) parts.push(`${row.flagged} flagged`);
  if (row.spreadIn !== '') parts.push(`spread ${row.spreadIn} in`);
  if (row.bodyweightLb !== null) parts.push(row.bodyweightLb);
  if (row.isBaseline) parts.push('baseline');
  if (!row.canonical) parts.push('not canonical');
  if (row.isPr) parts.push('PR');
  return parts.join(' · ');
}

export interface BodyweightSectionProps {
  readonly rows: readonly { readonly date: string; readonly lb: string }[];
}

/** Bodyweight beside tests: a jump number means less without the weight. */
export function BodyweightSection({ rows }: BodyweightSectionProps) {
  return (
    <Disclosure title="Bodyweight" summary={`${rows.length} readings`} testID="progress-bodyweight">
      {rows.length === 0 ? (
        <Text variant="caption" color="ink3">
          No bodyweight recorded with a test yet.
        </Text>
      ) : (
        <View style={{ gap: space.xs }}>
          {rows.map((row, index) => (
            <Text key={`${row.date}-${index}`} variant="caption" color="ink2" numeric>
              {`${row.date} · ${row.lb}`}
            </Text>
          ))}
        </View>
      )}
    </Disclosure>
  );
}
