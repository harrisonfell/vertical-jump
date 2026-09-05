import { useState } from 'react';
import { View } from 'react-native';
import { Hairline } from '../primitives/hairline';
import { useTheme } from '../theme';
import { JumpChart } from './jumpChart';
import { LoadPanel } from './loadPanel';
import type { IsoDay, JumpChartData, LoadWeek, RecoveryDay, RecoveryMeasure } from './props';
import { RecoveryPanel } from './recoveryPanel';
import { panelHeights } from './useChartSize';

export interface ThreePanelProps {
  readonly jump: JumpChartData;
  readonly weeks: readonly LoadWeek[];
  readonly days: readonly RecoveryDay[];
  readonly width: number;
  /** Which measure the third panel shows. The caller owns the selector control. */
  readonly measure?: RecoveryMeasure;
  readonly ownerMedian?: number | null;
  /** e.g. "Importing Whoop history · 40/90 days". */
  readonly recoveryCaption?: string;
  readonly showTables?: boolean;
}

/**
 * Output, load, and recovery on one shared x axis with one linked crosshair.
 *
 * The x domain is the program's own window in all three panels, so a week lines
 * up with the tests inside it. Only the bottom panel carries the x labels: three
 * copies of the same dates would be three times the ink for one reading. The
 * crosshair is lifted to this component, which is what makes it linked; each
 * panel snaps the probe to its own nearest mark on the shared day scale.
 */
export function ThreePanel({
  jump,
  weeks,
  days,
  width,
  measure = 'recovery',
  ownerMedian,
  recoveryCaption,
  showTables = true,
}: ThreePanelProps) {
  const { space } = useTheme();
  const [probe, setProbe] = useState<IsoDay | null>(null);
  const heights = panelHeights(width);

  return (
    <View style={{ gap: space.md }}>
      <JumpChart
        data={jump}
        width={width}
        height={heights.jump}
        showXAxis={false}
        showTable={showTables}
        probeDay={probe}
        onProbeChange={setProbe}
      />
      <Hairline />
      <LoadPanel
        weeks={weeks}
        programStart={jump.programStart}
        targetDate={jump.targetDate}
        width={width}
        height={heights.load}
        showXAxis={false}
        showTable={showTables}
        probeDay={probe}
        onProbeChange={setProbe}
      />
      <Hairline />
      <RecoveryPanel
        days={days}
        programStart={jump.programStart}
        targetDate={jump.targetDate}
        width={width}
        height={heights.recovery}
        measure={measure}
        ownerMedian={ownerMedian}
        caption={recoveryCaption}
        showTable={showTables}
        probeDay={probe}
        onProbeChange={setProbe}
      />
    </View>
  );
}
