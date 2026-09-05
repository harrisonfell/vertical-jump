/**
 * Generates apps/mobile/src/ui/tokens.generated.ts from tokens.oklch.ts.
 *
 * OKLCH is the authoring space; React Native cannot parse it, so every colour
 * is converted to sRGB hex here (gamut-clipped, chroma reduced rather than
 * channels clamped) and the rules are emitted as rgba() strings. The script
 * asserts WCAG 2.1 contrast and exits non-zero with a named failure so a bad
 * palette can never reach a screen.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clampChroma, converter, formatHex, parse } from 'culori';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiDir = join(root, 'apps', 'mobile', 'src', 'ui');
const sourcePath = join(uiDir, 'tokens.oklch.ts');
const outPath = join(uiDir, 'tokens.generated.ts');

const { schemeOklch, dataColors, ruleAlpha, ruleStrongAlpha } = await import(
  pathToFileURL(sourcePath).href
);

const toRgb = converter('rgb');

/** Parse an OKLCH or hex string, pull it into the sRGB gamut, return {r,g,b} in 0..1. */
function srgb(oklchString) {
  const parsed = parse(oklchString);
  if (!parsed) throw new Error(`cannot parse colour: ${oklchString}`);
  const clamped = clampChroma(parsed, 'rgb');
  const rgb = toRgb(clamped);
  return {
    r: Math.min(1, Math.max(0, rgb.r)),
    g: Math.min(1, Math.max(0, rgb.g)),
    b: Math.min(1, Math.max(0, rgb.b)),
  };
}

function hex(oklchString) {
  return formatHex(srgb(oklchString));
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }) {
  const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two OKLCH strings. */
function contrast(a, b) {
  const la = luminance(srgb(a));
  const lb = luminance(srgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgba(oklchString, alpha) {
  const { r, g, b } = srgb(oklchString);
  const to255 = (v) => Math.round(v * 255);
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${alpha})`;
}

/* ------------------------------------------------------------- assertions */

const failures = [];
const report = [];

function assertContrast(label, fg, bg, minimum, scheme) {
  const ratio = contrast(fg, bg);
  report.push({ scheme, label, ratio, minimum, pass: ratio >= minimum });
  if (ratio < minimum) {
    failures.push(
      `${scheme}: ${label} is ${ratio.toFixed(2)}:1, needs ${minimum.toFixed(1)}:1`,
    );
  }
}

for (const scheme of ['light', 'dark']) {
  const s = schemeOklch[scheme];
  const d = dataColors[scheme];

  for (const ink of ['ink', 'ink2', 'ink3']) {
    assertContrast(`${ink} on paper`, s[ink], s.paper, 4.5, scheme);
    assertContrast(`${ink} on paper2`, s[ink], s.paper2, 4.5, scheme);
  }
  for (const ground of ['paper', 'paper2', 'paper3']) {
    assertContrast(`green on ${ground}`, s.green, s[ground], 4.5, scheme);
  }
  assertContrast('onGreen on green', s.onGreen, s.green, 4.5, scheme);
  assertContrast('ink on greenSoft', s.ink, s.greenSoft, 4.5, scheme);

  for (const [name, value] of Object.entries(d)) {
    // Category colours are series identity and must clear 3:1 as marks.
    // Recovery bands are status fills that always sit beside a text label, so
    // they only need to be visible (2:1) on the ground.
    const minimum = name.startsWith('category.') ? 3.0 : 2.0;
    assertContrast(`${name} on paper`, value, s.paper, minimum, scheme);
  }
}

const banned = new Set(['#000000', '#ffffff']);
for (const scheme of ['light', 'dark']) {
  for (const [name, value] of Object.entries({
    ...schemeOklch[scheme],
    ...dataColors[scheme],
  })) {
    if (banned.has(hex(value))) {
      failures.push(`${scheme}: ${name} resolves to ${hex(value)}, which is banned`);
    }
  }
}

for (const row of report) {
  const mark = row.pass ? 'ok  ' : 'FAIL';
  process.stdout.write(
    `${mark} ${row.scheme.padEnd(5)} ${row.label.padEnd(30)} ${row.ratio
      .toFixed(2)
      .padStart(6)}:1  (min ${row.minimum.toFixed(1)})\n`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`\ncontrast assertions failed:\n`);
  for (const line of failures) process.stderr.write(`  ${line}\n`);
  process.stderr.write(
    `\nFix the OKLCH values in apps/mobile/src/ui/tokens.oklch.ts, then run npm run tokens again.\n`,
  );
  process.exit(1);
}

/* ---------------------------------------------------------------- emitter */

function schemeBlock(scheme) {
  const s = schemeOklch[scheme];
  const d = dataColors[scheme];
  const lines = [];
  for (const key of Object.keys(s)) lines.push(`    ${key}: '${hex(s[key])}',`);
  lines.push(`    rule: '${rgba(s.ink, ruleAlpha[scheme])}',`);
  lines.push(`    ruleStrong: '${rgba(s.ink, ruleStrongAlpha[scheme])}',`);
  lines.push('    data: {');
  for (const key of Object.keys(d)) lines.push(`      '${key}': '${hex(d[key])}',`);
  lines.push('    },');
  return lines.join('\n');
}

const output = `// generated by scripts/gen-tokens.mjs, do not edit
// Source of truth: apps/mobile/src/ui/tokens.oklch.ts
// Regenerate with: npm run tokens

export type SchemeName = 'light' | 'dark';

export type DataTokenName =
${Object.keys(dataColors.light)
  .map((name, index, all) => `  | '${name}'${index === all.length - 1 ? ';' : ''}`)
  .join('\n')}

export interface SchemeColors {
  /** The ground. Never pure white, never pure black. */
  readonly paper: string;
  /** A second neutral for panels, the bottom bar, and inputs. */
  readonly paper2: string;
  /** A third neutral for pressed states. */
  readonly paper3: string;
  /** Primary text and hairlines. */
  readonly ink: string;
  /** Secondary text. */
  readonly ink2: string;
  /** Tertiary text, still at or above 4.5:1 on paper and paper2. */
  readonly ink3: string;
  /** The single accent. */
  readonly green: string;
  /** A quiet green ground for the selected row. */
  readonly greenSoft: string;
  /** Text on a committed green surface. */
  readonly onGreen: string;
  /** 1px hairline. */
  readonly rule: string;
  /** A heavier rule for chart axes. */
  readonly ruleStrong: string;
  /** Charts, chips, and glyph fills only. Never chrome, never text. */
  readonly data: Readonly<Record<DataTokenName, string>>;
}

export const colors: Readonly<Record<SchemeName, SchemeColors>> = {
  light: {
${schemeBlock('light')}
  },
  dark: {
${schemeBlock('dark')}
  },
};
`;

writeFileSync(outPath, output, 'utf8');
process.stdout.write(`\nwrote ${outPath}\n`);
