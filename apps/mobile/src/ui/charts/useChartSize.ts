import { useCallback, useState } from 'react';
import { useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { breakpoint } from '../theme';

/** Panel heights: phone, then the wide layout at tablet width and up. */
const HEIGHTS = {
  phone: { jump: 200, load: 120, recovery: 140 },
  wide: { jump: 280, load: 160, recovery: 180 },
} as const;

export interface PanelHeights {
  readonly jump: number;
  readonly load: number;
  readonly recovery: number;
}

/** The panel heights for a container of this width. */
export function panelHeights(width: number): PanelHeights {
  return width >= breakpoint.tablet ? HEIGHTS.wide : HEIGHTS.phone;
}

export interface ChartSize {
  /** The measured container width, or the fallback before the first layout. */
  readonly width: number;
  readonly heights: PanelHeights;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Measures the container a chart fills.
 *
 * The fallback matters: the web export statically renders every route in node,
 * where no layout pass ever runs, so a chart that waited for a real measurement
 * would export as an empty box. It renders at the fallback width instead and
 * settles on the true width on the client's first layout.
 */
export function useChartSize(fallbackWidth?: number): ChartSize {
  const window = useWindowDimensions();
  const fallback = fallbackWidth ?? Math.max(280, Math.min(window.width, 640) - 32);
  const [measured, setMeasured] = useState<number | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setMeasured((current) => (current === next ? current : next));
  }, []);

  const width = measured !== null && measured > 0 ? measured : fallback;
  return { width, heights: panelHeights(width), onLayout };
}
