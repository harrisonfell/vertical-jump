import Svg, { Path } from 'react-native-svg';
import {
  GLYPHS,
  GLYPH_NAMES,
  GLYPH_STROKE,
  GLYPH_VIEW_BOX,
  glyphNames,
  glyphPaths,
  type GlyphName,
  type GlyphPath,
} from './registry';

export {
  GLYPHS,
  GLYPH_NAMES,
  GLYPH_STROKE,
  GLYPH_VIEW_BOX,
  glyphNames,
  glyphPaths,
  type GlyphName,
  type GlyphPath,
};

export interface GlyphProps {
  /** A token-resolved colour, never a raw hex from a screen. */
  readonly color: string;
  readonly size?: number;
}

export interface NamedGlyphProps extends GlyphProps {
  readonly name: GlyphName;
}

function render(paths: readonly GlyphPath[], color: string, size: number) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={GLYPH_VIEW_BOX}
      fill="none"
      stroke={color}
      strokeWidth={GLYPH_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((path, index) => (
        <Path
          key={`${index}-${path.d.length}`}
          d={path.d}
          {...(path.fill === true ? { fill: color, stroke: 'none' } : null)}
          {...(path.dash === undefined ? null : { strokeDasharray: path.dash })}
        />
      ))}
    </Svg>
  );
}

/**
 * The one glyph component. It never carries meaning alone: every place it is
 * used, a word sits beside it or an accessibilityLabel sits on its parent.
 */
export function Glyph({ name, color, size = 20 }: NamedGlyphProps) {
  return render(GLYPHS[name], color, size);
}

/** Today: a takeoff off the floor line. */
export function TodayGlyph({ color, size = 20 }: GlyphProps) {
  return render(GLYPHS.today, color, size);
}

/** Plan: the week's sessions as a list. */
export function PlanGlyph({ color, size = 20 }: GlyphProps) {
  return render(GLYPHS.plan, color, size);
}

/** Progress: the trend rising toward a dashed goal line. */
export function ProgressGlyph({ color, size = 20 }: GlyphProps) {
  return render(GLYPHS.progress, color, size);
}
