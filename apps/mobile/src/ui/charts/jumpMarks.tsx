import { Circle, G } from 'react-native-svg';
import type { JumpPoint } from './props';
import { MARK } from './scale';

export interface MarkerProps {
  readonly x: number;
  readonly y: number;
  /** Filled for a canonical test; hollow for anything the trend does not see. */
  readonly filled: boolean;
  readonly surface: string;
  readonly ink: string;
}

/**
 * A test mark: a filled 8px dot when the trend counts it, hollow when it does
 * not. Both carry a 2px ring in the surface colour so a mark stays legible
 * where it crosses a line or another mark, which is the ring's job rather than
 * a stroke's: a stroke would add data-weight ink that is not data.
 */
export function Marker({ x, y, filled, surface, ink }: MarkerProps) {
  return (
    <G>
      <Circle cx={x} cy={y} r={MARK.dotRadius + MARK.gap} fill={surface} />
      <Circle
        cx={x}
        cy={y}
        r={MARK.dotRadius}
        fill={filled ? ink : surface}
        stroke={ink}
        strokeWidth={filled ? 0 : 1.5}
      />
    </G>
  );
}

/** The word the table twin and the tooltip use for a test's standing. */
export function testState(test: JumpPoint): string {
  if (test.flagged === true) return 'Flagged';
  if (!test.canonical) return 'Not canonical';
  if (test.pr === true) return 'PR';
  return 'Canonical';
}
