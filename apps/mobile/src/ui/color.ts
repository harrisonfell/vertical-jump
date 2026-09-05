/**
 * The one colour operation the UI kit performs at runtime: putting a token
 * behind an alpha. Everything else comes out of tokens.generated.ts already
 * resolved, because the generator is where contrast is asserted.
 */

const HEX_SIX = /^#([0-9a-fA-F]{6})$/;
const HEX_THREE = /^#([0-9a-fA-F]{3})$/;

/**
 * Returns `color` at `alpha`. Accepts the `#rrggbb` and `#rgb` forms the token
 * file emits; anything else (an already-alpha `rgba(...)` rule token) is
 * returned untouched rather than mangled.
 */
export function withAlpha(color: string, alpha: number): string {
  const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

  const six = HEX_SIX.exec(color);
  const three = six === null ? HEX_THREE.exec(color) : null;

  let body: string | undefined;
  if (six !== null) {
    body = six[1];
  } else if (three !== null) {
    const short = three[1];
    if (short !== undefined) {
      body = short
        .split('')
        .map((c) => `${c}${c}`)
        .join('');
    }
  }
  if (body === undefined) return color;

  const value = Number.parseInt(body, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

/** The backdrop behind a sheet: ink at 40%, never a pure black scrim. */
export const BACKDROP_ALPHA = 0.4;
