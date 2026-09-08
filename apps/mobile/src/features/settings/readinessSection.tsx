import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatInteger, formatReadinessValue, readinessTestNoun } from '@vert/engine';
import type { ReadinessTestSession } from '@/data';
import { Button, Sheet, Table, space, useSheet } from '@/ui';
import {
  METRIC_FOR_KIND,
  READINESS_KIND_OPTIONS,
  ReadinessBlock,
  type ReadinessConfigValues,
} from '../setup';
import { RowDivider, SettingRow, SettingSection } from './row';
import { shortCalendarDate } from './regenerate';

/**
 * The readiness gate, as Settings shows it (house `house.sc.readiness_gate`).
 *
 * The gate is two channels and they are never averaged, so this section is
 * only ever about channel B: which output test is configured, how it is
 * scored, and what the last seven runs of it read. Channel A is the Whoop
 * recovery score and lives under Whoop, where its own attribution is.
 *
 * A configuration change is not a program change: it decides how tomorrow is
 * scored, not what next week contains, so it saves on its own and never opens
 * the regeneration confirm.
 */

/** Seven, because the shipped baseline window is seven tests. */
export const TESTS_SHOWN = 7;

export const READINESS_NOTE = 'The neuromuscular channel of the daily gate.';

export interface ReadinessSectionProps {
  readonly config: ReadinessConfigValues;
  /** Every logged session of the configured kind, oldest first. */
  readonly tests: readonly ReadinessTestSession[];
  readonly onSave: (config: ReadinessConfigValues) => void;
  readonly saving: boolean;
}

function kindLabel(config: ReadinessConfigValues): string {
  return (
    READINESS_KIND_OPTIONS.find((option) => option.value === config.kind)?.label ?? config.kind
  );
}

export function ReadinessSection({ config, tests, onSave, saving }: ReadinessSectionProps) {
  const sheet = useSheet();
  const [draft, setDraft] = useState<ReadinessConfigValues>(config);

  // The sheet opens on what is stored, not on what was typed and abandoned
  // the last time it was open.
  useEffect(() => {
    if (sheet.open) setDraft(config);
  }, [sheet.open, config]);

  const metric = METRIC_FOR_KIND[config.kind];
  const recent = [...tests].slice(-TESTS_SHOWN).reverse();

  return (
    <SettingSection title="Readiness" note={READINESS_NOTE} testID="settings-readiness">
      <SettingRow
        label="Readiness test"
        value={kindLabel(config)}
        caption="The gate reads the best attempt of the day."
        chevron
        onPress={sheet.show}
        testID="settings-readiness-test"
      />
      <RowDivider />
      <SettingRow
        label="Attempts"
        value={formatInteger(config.attempts)}
        numeric
        testID="settings-readiness-attempts"
      />
      <RowDivider />
      <SettingRow
        label="Baseline window"
        value={`${formatInteger(config.baselineWindow)} tests`}
        caption="The rolling median the day is scored against."
        numeric
        testID="settings-readiness-window"
      />
      <RowDivider />
      <SettingRow
        label="Low threshold"
        value={`${formatInteger(config.lowThresholdPct)}%`}
        caption="More than this far below the median reads low."
        numeric
        testID="settings-readiness-threshold"
      />
      <RowDivider />

      <View style={{ paddingTop: space.md, gap: space.sm }}>
        <Table<ReadinessTestSession>
          caption={`Last ${formatInteger(TESTS_SHOWN)} ${readinessTestNoun(config.kind)} tests`}
          columns={[
            { key: 'date', header: 'Date', render: (row) => shortCalendarDate(row.localDate) },
            {
              key: 'best',
              header: 'Best',
              numeric: true,
              render: (row) =>
                row.best === null ? 'not logged' : formatReadinessValue(row.best, metric),
            },
            {
              key: 'attempts',
              header: 'Attempts',
              numeric: true,
              width: 88,
              render: (row) => formatInteger(row.attempts.length),
            },
          ]}
          rows={recent}
          rowKey={(row) => row.id}
          emptyText="No readiness test logged yet. The gate runs on the recovery score alone until one is."
          testID="settings-readiness-tests"
        />
      </View>

      <Sheet
        visible={sheet.open}
        onClose={sheet.hide}
        title="Readiness test"
        subtitle="Applies to the next gate. Nothing already scored changes."
        actions={
          <Button
            label="Save readiness test"
            variant="primary"
            fullWidth
            loading={saving}
            onPress={() => {
              onSave(draft);
              sheet.hide();
            }}
            testID="settings-readiness-save"
          />
        }
      >
        <ReadinessBlock values={draft} onChange={setDraft} />
      </Sheet>
    </SettingSection>
  );
}
