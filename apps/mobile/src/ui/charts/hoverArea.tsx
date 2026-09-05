import { useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, View } from 'react-native';

export interface HoverAreaProps {
  readonly width: number;
  readonly height: number;
  /** The x inside the area, or null when the pointer leaves it. */
  readonly onProbe: (x: number | null) => void;
  readonly children?: ReactNode;
}

/**
 * The continuous-probe layer, native build.
 *
 * Touch has no hover, so the crosshair rides a press-and-drag: the responder
 * grants on touch and reports every move, which is the long-press scrub the
 * brief asks for. PanResponder is core react-native on purpose; importing
 * react-native-gesture-handler here would reach the web export's static render
 * pass and crash it.
 */
export function HoverArea({ width, height, onProbe, children }: HoverAreaProps) {
  const probe = useRef(onProbe);
  probe.current = onProbe;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => probe.current(event.nativeEvent.locationX),
        onPanResponderMove: (event) => probe.current(event.nativeEvent.locationX),
        onPanResponderRelease: () => probe.current(null),
        onPanResponderTerminate: () => probe.current(null),
      }),
    [],
  );

  return (
    <View style={{ width, height }} {...responder.panHandlers}>
      {children}
    </View>
  );
}
