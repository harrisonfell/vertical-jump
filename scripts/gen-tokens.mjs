/**
 * Generates apps/mobile/src/ui/tokens.generated.ts from tokens.oklch.ts.
 *
 * OKLCH is the authoring space; React Native cannot parse it, so every colour
 * is converted to sRGB hex here (gamut-clipped, chroma reduced rather than
 * channels clamped) and the rules are emitted as rgba() strings.
 *
 * The script is the only place the palette is checked, so it checks everything
 * a screen can get wrong and exits non-zero with a named failure:
 *
 *   - WCAG 2.1 contrast for every ink level on every ground, `paper3` (the
 *     pressed background) included, and for the accent and the two state tones.
 *   - Colour-vision separation inside each data group, simulated for
 *     protanopia, deuteranopia and tritanopia as well as normal vision.
 *   - Distance from the accent, so no data colour can be read as "selected".
 *   - No pure black and no pure white.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clampChroma, converter, differenceCiede2000, formatHex, parse } from 'culori';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiDir = join(root, 'apps', 'mobile', 'src', 'ui');
const sourcePath = join(uiDir, 'tokens.oklch.ts');
const outPath = join(uiDir, 'tokens.generated.ts');

const { schemeOklch, dataColors, ruleAlpha, ruleStrongAlpha } = await import(
  pathToFileURL(sourcePath).href
);

const toRgb = converter('rgb');
const ciede = differenceCiede2000();

/** Parse an OKLCH or hex string, pull it into the sRGB gamut, return {r,g,b} in 0..1. */
function srgb(oklchString) {
  const parsed = parse(oklchString);
  if (!parsed) throw new Error(`cannot parse colour: ${oklchString}`);
  const clamped = clampChroma(parsed, 'rgb');
  const rgb = toRgb(clamped);
  return {
    mode: 'rgb',
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

/* ------------------------------------------------- colour-vision simulation */

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v) => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};

/** Dichromacy matrices, applied in linear sRGB. */
const CVD = {
  protan: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

function simulate(oklchString, kind) {
  const c = srgb(oklchString);
  const [r, g, b] = [toLinear(c.r), toLinear(c.g), toLinear(c.b)];
  const m = CVD[kind];
  return {
    mode: 'rgb',
    r: toGamma(m[0] * r + m[1] * g + m[2] * b),
    g: toGamma(m[3] * r + m[4] * g + m[5] * b),
    b: toGamma(m[6] * r + m[7] * g + m[8] * b),
  };
}

/** The worst CIEDE2000 distance across normal vision and the three dichromacies. */
function worstSeparation(a, b) {
  let worst = ciede(srgb(a), srgb(b));
  for (const kind of Object.keys(CVD)) {
    worst = Math.min(worst, ciede(simulate(a, kind), simulate(b, kind)));
  }
  return worst;
}

/* ------------------------------------------------------------- assertions */

/** Every data colour must sit this far from the accent to never read as "selected". */
const MIN_FROM_ACCENT = 22;
/** Separation inside a data group, worst case across normal vision and dichromacy. */
const MIN_SEPARATION = 14;

const failures = [];
const report = [];

function assertContrast(label, fg, bg, minimum, scheme) {
  const ratio = contrast(fg, bg);
  report.push({ scheme, label, value: ratio, minimum, pass: ratio >= minimum, unit: ':1' });
  if (ratio < minimum) {
    failures.push(`${scheme}: ${label} is ${ratio.toFixed(2)}:1, needs ${minimum.toFixed(1)}:1`);
  }
}

function assertDistance(label, a, b, minimum, scheme, distance) {
  const value = distance(a, b);
  report.push({ scheme, label, value, minimum, pass: value >= minimum, unit: ' dE' });
  if (value < minimum) {
    failures.push(`${scheme}: ${label} is ${value.toFixed(1)} dE, needs ${minimum.toFixed(1)}`);
  }
}

const GROUNDS = ['paper', 'paper2', 'paper3'];
/** Text and glyph tones. Every one clears AA on every ground, pressed included. */
const FOREGROUNDS = ['ink', 'ink2', 'ink3', 'green', 'warn', 'danger'];

for (const scheme of ['light', 'dark']) {
  const s = schemeOklch[scheme];
  const d = dataColors[scheme];

  for (const fg of FOREGROUNDS) {
    for (const ground of GROUNDS) {
      assertContrast(`${fg} on ${ground}`, s[fg], s[ground], 4.5, scheme);
    }
  }
  assertContrast('onGreen on green', s.onGreen, s.green, 4.5, scheme);
  assertContrast('ink on greenSoft', s.ink, s.greenSoft, 4.5, scheme);
  // The check glyph on a selected row: a non-text mark, so 3:1.
  assertContrast('green on greenSoft', s.green, s.greenSoft, 3.0, scheme);

  // Every data colour is a chart series or a chip mark: 3:1 as a graphical object.
  for (const [name, value] of Object.entries(d)) {
    assertContrast(`${name} on paper`, value, s.paper, 3.0, scheme);
    assertDistance(`${name} vs accent`, value, s.green, MIN_FROM_ACCENT, scheme, (a, b) =>
      ciede(srgb(a), srgb(b)),
    );
  }

  // Separation inside a group. Groups never share a surface, so cross-group
  // pairs are not compared: a recovery dot and a category mark never meet.
  for (const group of ['category', 'recovery']) {
    const names = Object.keys(d).filter((name) => name.startsWith(`${group}.`));
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = names[i];
        const b = names[j];
        assertDistance(
          `${a.slice(group.length + 1)} vs ${b.slice(group.length + 1)}`,
          d[a],
          d[b],
          MIN_SEPARATION,
          scheme,
          worstSeparation,
        );
      }
    }
  }
}

/**
 * Every neutral is tinted toward the accent hue, and only tinted: below 0.005
 * it is a pure grey, above 0.01 it starts reading as a colour rather than as
 * paper or ink. The accent, the two state tones, `greenSoft` and `onGreen` are
 * exempt because they are colours on purpose.
 */
const NEUTRALS = ['paper', 'paper2', 'paper3', 'ink', 'ink2', 'ink3'];
const TINT_MIN = 0.005;
const TINT_MAX = 0.01;

for (const scheme of ['light', 'dark']) {
  for (const name of NEUTRALS) {
    const value = schemeOklch[scheme][name];
    const { c } = parse(value);
    const pass = c >= TINT_MIN && c <= TINT_MAX;
    report.push({
      scheme,
      label: `${name} tint`,
      value: c,
      minimum: TINT_MIN,
      pass,
      unit: ' C',
    });
    if (!pass) {
      failures.push(
        `${scheme}: ${name} has chroma ${c.toFixed(3)}, needs ${TINT_MIN} to ${TINT_MAX}`,
      );
    }
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
    `${mark} ${row.scheme.padEnd(5)} ${row.label.padEnd(30)} ${row.value
      .toFixed(2)
      .padStart(6)}${row.unit}  (min ${row.minimum.toFixed(1)})\n`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`\npalette assertions failed:\n`);
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
  /** A third neutral for pressed states. Every ink level clears AA on it. */
  readonly paper3: string;
  /** Primary text and hairlines. */
  readonly ink: string;
  /** Secondary text. */
  readonly ink2: string;
  /** Tertiary text, still at or above 4.5:1 on all three grounds. */
  readonly ink3: string;
  /** The single accent. */
  readonly green: string;
  /** A quiet green ground for the selected row. */
  readonly greenSoft: string;
  /** Text on a committed green surface. */
  readonly onGreen: string;
  /** Known but not current: a stale mirror, a queue that has not drained. */
  readonly warn: string;
  /** Wrong and blocking: an invalid answer, a sync that failed. */
  readonly danger: string;
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
