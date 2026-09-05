import { useState } from 'react';
import { View } from 'react-native';
import { ChipRow, Text, space } from '@/ui';
import {
  ThreePanel,
  useChartSize,
  type JumpChartData,
  type LoadWeek,
  type RecoveryDay,
  type RecoveryMeasure,
} from '@/ui/charts';

const MEASURES: readonly { value: RecoveryMeasure; label: string }[] = [
  { value: 'recovery', label: 'Recovery' },
  { value: 'hrv', label: 'HRV' },
  { value: 'sleep', label: 'Sleep performance' },
];

export interface ProgressChartsProps {
  readonly jump: JumpChartData;
  readonly weeks: readonly LoadWeek[];
  readonly days: readonly RecoveryDay[];
  readonly ownerMedian: number | null;
  readonly caption: string | null;
}

/**
 * Output, load, and recovery on one shared time axis.
 *
 * The three panels are one stack with one linked crosshair, so a week of load
 * lines up with the test inside it. The selector swaps only the third panel:
 * HRV and sleep performance answer the same question recovery does, and
 * stacking all three would make the page an argument with itself.
 */
export function ProgressCharts({ jump, weeks, days, ownerMedian, caption }: ProgressChartsProps) {
  const { width, onLayout } = useChartSize();
  const [measure, setMeasure] = useState<RecoveryMeasure>('recovery');

  return (
    <View style={{ gap: space.md }} onLayout={onLayout} testID="progress-charts">
      <ThreePanel
        jump={jump}
        weeks={weeks}
        days={days}
        width={width}
        measure={measure}
        ownerMedian={ownerMedian}
        {...(caption === null ? null : { recoveryCaption: caption })}
      />
      <View style={{ gap: space.xs }}>
        <Text variant="label" color="ink2">
          Third panel
        </Text>
        <ChipRow
          options={MEASURES}
          value={measure}
          groupLabel="Recovery measure"
          onChange={setMeasure}
        />
      </View>
      <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
        Load is session RPE times minutes. Whoop strain is heart-rate derived and under-reads
        plyometric and strength work, so it rides beside the load as evidence and never on the same
        axis as jump height. Data by WHOOP.
      </Text>
    </View>
  );
}
