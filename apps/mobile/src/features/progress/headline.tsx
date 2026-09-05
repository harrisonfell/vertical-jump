import { View } from 'react-native';
import { Glyph, Hairline, Text, space, useTheme } from '@/ui';
import { Sparkline } from '@/ui/charts';
import { NO_VALUE } from './derive';
import type { HeadlineModel } from './types';

interface FigureProps {
  readonly label: string;
  readonly value: string;
}

function Figure({ label, value }: FigureProps) {
  const missing = value === '';

  return (
    <View style={{ gap: 2, minWidth: 72 }}>
      <Text variant="label" color="ink3">
        {label}
      </Text>
      <Text variant="title" color={missing ? 'ink3' : 'ink'} numeric={!missing}>
        {missing ? NO_VALUE : value}
      </Text>
    </View>
  );
}

export interface HeadlineProps {
  readonly model: HeadlineModel;
  /** The pace sentence, in one of the five honest states. Never a pill. */
  readonly paceLine: string;
  readonly noiseNote: string | null;
  readonly trendCaption: string | null;
  /**
   * Give up the display size, because a card above owns it. One screen has one
   * big number; the latest height then rides at title size beside the
   * instrument and the figure row is unchanged.
   */
  readonly compact?: boolean;
}

/**
 * The three decision numbers, in the order the evening asks for them: where
 * the jump is now, where it has to get to, and whether the rate is enough.
 *
 * One display number a screen. The PR flag rides inline with the instrument
 * label rather than colouring the number, so the surface stays paper and the
 * committed green is kept for the record itself.
 */
export function Headline({
  model,
  paceLine,
  noiseNote,
  trendCaption,
  compact = false,
}: HeadlineProps) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.md }} testID="progress-headline">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          {model.valueIn === null ? (
            /* No canonical test yet: there is no number to show, so the space
               says so in words rather than holding a placeholder glyph. */
            <Text variant="title" color="ink3">
              No tests yet
            </Text>
          ) : compact ? (
            <Text variant="title" color="ink" numeric testID="progress-headline-value">
              {`${model.valueIn} in`}
            </Text>
          ) : (
            <>
              <Text variant="display" color="ink" testID="progress-headline-value">
                {model.valueIn}
              </Text>
              <Text variant="title" color="ink2">
                in
              </Text>
            </>
          )}
        </View>
        {model.sparkline.length >= 2 ? (
          <View style={{ paddingBottom: space.sm }}>
            <Sparkline values={model.sparkline} label={model.sparklineLabel} />
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="label" color="ink2">
          {`${model.instrumentLabel} · ${model.mode}`}
        </Text>
        {model.isPr ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Glyph name="pr" color={colors.green} size={16} />
            <Text variant="label" color="green">
              PR
            </Text>
          </View>
        ) : null}
      </View>

      <Hairline />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>
        <Figure label="PR" value={model.prIn === null ? '' : `${model.prIn} in`} />
        <Figure label="Goal" value={model.goalIn === '' ? '' : `${model.goalIn} in`} />
        <Figure label="Gap" value={model.gapIn === '' ? '' : `${model.gapIn} in`} />
        <Figure label="Weeks left" value={model.weeksLeft} />
      </View>
      <Hairline />

      {paceLine === '' ? null : (
        <Text variant="body" color="ink" style={{ maxWidth: 560 }} accessibilityLiveRegion="polite">
          {paceLine}
        </Text>
      )}
      {trendCaption === null ? null : (
        <Text variant="caption" color="ink2">
          {trendCaption}
        </Text>
      )}
      {noiseNote === null ? null : (
        <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
          {noiseNote}
        </Text>
      )}
      {model.thresholdReason === '' ? null : (
        <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
          {model.thresholdReason}
        </Text>
      )}
    </View>
  );
}
