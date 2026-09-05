import { useCallback, type ComponentType } from 'react';
import { View, type ViewProps } from 'react-native';
import type { HoverAreaProps } from './hoverArea';

/** A DOM mouse event, structurally typed so this file needs no DOM lib. */
interface MouseLike {
  readonly clientX: number;
  readonly currentTarget: { getBoundingClientRect: () => { readonly left: number } };
}

type MouseViewProps = ViewProps & {
  readonly onMouseMove?: (event: MouseLike) => void;
  readonly onMouseLeave?: () => void;
};

/**
 * react-native-web forwards the mouse props straight to the DOM node, but
 * react-native's own ViewProps has no room for them. Widening the component
 * type is the whole of the platform difference.
 */
const MouseView = View as unknown as ComponentType<MouseViewProps>;

/**
 * The continuous-probe layer, web build: a real pointer means a real hover
 * crosshair, with no press required. Per-point keyboard focus is handled by the
 * focusable hit targets the chart draws on top of this.
 */
export function HoverArea({ width, height, onProbe, children }: HoverAreaProps) {
  const handleMove = useCallback(
    (event: MouseLike) => {
      const left = event.currentTarget.getBoundingClientRect().left;
      onProbe(event.clientX - left);
    },
    [onProbe],
  );
  const handleLeave = useCallback(() => onProbe(null), [onProbe]);

  return (
    <MouseView style={{ width, height }} onMouseMove={handleMove} onMouseLeave={handleLeave}>
      {children}
    </MouseView>
  );
}

export type { HoverAreaProps };
