import { View } from 'react-native';
import { Button, space } from '@/ui';
import type { LocalDate } from '@/data';
import type { BestSetsDraft, SportValue } from '../setup';
import { BestSetRows } from './bestSetRows';
import { RowDivider, SettingRow, SettingSection } from './row';
import { workingMaxRows, type LiftSource } from './lifts';

/**
 * Lifts: the working max per lift, where it came from, and the estimate.
 *
 * The engine freezes the working max and only ever raises it inside its own
 * cap, so the rows read rather than edit: the one action is adopting the
 * estimate, and it only appears when the estimate would actually change the
 * number. Below them sits the one number the athlete does type, the best
 * recent set R73 estimates from.
 */

export interface LiftsSectionProps {
  readonly lifts: readonly LiftSource[];
  readonly onUseEstimate: (exerciseId: string, estimateKg: number) => void;
  readonly busyLiftId: string | null;
  /** Which lifts the best-set rows are offered for. */
  readonly sport: SportValue;
  readonly bestSets: BestSetsDraft;
  readonly today: LocalDate;
  readonly onSaveBestSets: (draft: BestSetsDraft) => void;
  readonly savingBestSets?: boolean;
}

export function LiftsSection({
  lifts,
  onUseEstimate,
  busyLiftId,
  sport,
  bestSets,
  today,
  onSaveBestSets,
  savingBestSets = false,
}: LiftsSectionProps) {
  const rows = workingMaxRows(lifts);

  return (
    <SettingSection
      title="Lifts"
      note="Working max is the per-lift maximum the plan prescribes from."
      testID="settings-lifts"
    >
      {rows.length === 0 ? (
        <SettingRow
          label="No lifts yet"
          caption="Log a week of sets and the working max appears here."
        />
      ) : null}
      {rows.map((row, index) => (
        <View key={row.exerciseId}>
          {index === 0 ? null : <RowDivider />}
          <SettingRow
            label={row.name}
            value={row.valueLine}
            caption={
              row.estimateLine === null ? row.sourceLine : `${row.sourceLine} · ${row.estimateLine}`
            }
            numeric
            testID={`settings-lift-${row.exerciseId}`}
          >
            {row.canUseEstimate && row.estimateKg !== null ? (
              <View style={{ flexDirection: 'row', paddingTop: space.sm }}>
                <Button
                  label="Use estimate"
                  variant="secondary"
                  loading={busyLiftId === row.exerciseId}
                  disabled={busyLiftId !== null}
                  onPress={() => {
                    if (row.estimateKg !== null) onUseEstimate(row.exerciseId, row.estimateKg);
                  }}
                  testID={`settings-use-estimate-${row.exerciseId}`}
                />
              </View>
            ) : null}
          </SettingRow>
        </View>
      ))}

      <BestSetRows
        sport={sport}
        bestSets={bestSets}
        today={today}
        onSave={onSaveBestSets}
        saving={savingBestSets}
      />
    </SettingSection>
  );
}
