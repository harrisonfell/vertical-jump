import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No feature screen hands its text colour to the browser.
 *
 * expo-router renders every `Link` as an anchor, and an anchor's text takes the
 * user agent's link colour unless something sets one. On the Progress weeks
 * table that turned the week numbers and the "4/4" cells browser blue: out of
 * the ink palette, and out of the tabular column beside them. The web build
 * carries a reset for it, but a reset is a second line of defence; the colour
 * is the app's to name at the point the text is written.
 *
 * So the rule is on the source: a `Link` either names a `color`, or its text
 * goes through the `Text` component (which always writes a colour token into
 * the style), or it has no text of its own at all. Rendering the whole feature
 * tree would need a renderer this project does not carry, so the guard reads
 * the files instead and the next `Link` added without a colour fails here.
 */

const FEATURES = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** The end of the JSX opening tag that starts at `open`, or -1. */
function endOfOpeningTag(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let at = open; at < source.length; at += 1) {
    const character = source[at];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return at;
  }
  return -1;
}

/** Where `<Link ...>` opens: the tag name has to end, so `<Linkish` is not one. */
const LINK_OPEN = /<Link(?=[\s/>])/g;

export interface LinkIssue {
  readonly file: string;
  readonly text: string;
}

/**
 * Every `Link` in one file that writes text with no colour of its own.
 *
 * `attributes` is the opening tag, `body` everything up to the closing tag.
 * A body with a `Text` child is fine, and so is a body with no words in it
 * (a glyph, a nested pressable, nothing at all).
 */
export function linkColorIssues(source: string, file = 'source'): LinkIssue[] {
  const issues: LinkIssue[] = [];
  for (const match of source.matchAll(LINK_OPEN)) {
    const open = match.index;
    const tagEnd = endOfOpeningTag(source, open);
    if (tagEnd < 0) continue;
    const attributes = source.slice(open, tagEnd);
    if (/\bcolor\s*=/.test(attributes)) continue;
    if (source[tagEnd - 1] === '/') continue;

    const close = source.indexOf('</Link>', tagEnd);
    const body = close < 0 ? source.slice(tagEnd + 1) : source.slice(tagEnd + 1, close);
    if (/<Text[\s/>]/.test(body)) continue;

    // Words the anchor renders itself: everything that is not a nested
    // element, a JSX expression, or whitespace.
    const words = body
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{[^}]*\}/g, ' ')
      .trim();
    if (words === '') continue;
    issues.push({ file, text: words.slice(0, 60) });
  }
  return issues;
}

describe('linkColorIssues', () => {
  it('reports a Link that writes bare text', () => {
    expect(linkColorIssues('<Link href="/plan">Week 7</Link>')).toHaveLength(1);
  });

  it('accepts a Link that names a colour', () => {
    expect(linkColorIssues('<Link href="/plan" color="ink">Week 7</Link>')).toEqual([]);
  });

  it('accepts a Link whose text is a Text child', () => {
    expect(
      linkColorIssues('<Link href="/plan"><Text color="ink">Week 7</Text></Link>'),
    ).toEqual([]);
  });

  it('accepts a Link with no text of its own', () => {
    expect(linkColorIssues('<Link href="/plan" asChild><Glyph name="chevron" /></Link>')).toEqual(
      [],
    );
    expect(linkColorIssues('<Link href="/plan" />')).toEqual([]);
  });

  it('does not mistake another component for a Link', () => {
    expect(linkColorIssues('<LinkSection whoopStatus="connected">Whoop</LinkSection>')).toEqual([]);
  });
});

describe('every Link under src/features names its text colour', () => {
  const files = walk(FEATURES);

  it('has feature sources to read', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('leaves no anchor text to the browser', () => {
    const issues = files.flatMap((path) =>
      linkColorIssues(readFileSync(path, 'utf8'), path.slice(FEATURES.length)),
    );
    expect(issues).toEqual([]);
  });
});

/**
 * The weeks table is where this was seen, and the cell is where it is fixed:
 * the Table primitive writes a colour token and tabular figures on every cell,
 * numeric column or not, so no cell inherits a colour and no digit column
 * loses its figure widths.
 */
describe('the Table primitive colours every cell itself', () => {
  const table = readFileSync(
    fileURLToPath(new URL('../../ui/primitives/table.tsx', import.meta.url)),
    'utf8',
  );

  it('names ink on the cell, not a fallback', () => {
    expect(table).toContain('color="ink"');
    expect(table).not.toMatch(/color=\{column\.numeric/);
  });

  it('keeps tabular figures on text columns as well as numeric ones', () => {
    expect(table).not.toMatch(/numeric=\{column\.numeric/);
  });

  /**
   * D-48: the token alone was not enough in a headless render. The colour is
   * now written into the cell's own style object at render time, so the markup
   * a static export ships already carries it and no rule injected later, or
   * never injected at all, decides what colour a week number is.
   */
  it('writes the resolved colour into the cell style at render', () => {
    expect(table).toContain('color: colors.ink,');
    expect(table).toContain('color: colors.ink3,');
  });

  /** Nothing inside the table can become an anchor: it has no pressable at all. */
  it('renders no link and no pressable of its own', () => {
    expect(table).not.toMatch(/<Link(?=[\s/>])/);
    expect(table).not.toMatch(/Pressable/);
    expect(table).not.toContain('accessibilityRole="link"');
  });
});

/**
 * D-48, the other half: no anchor wraps table text on /progress.
 *
 * The route is thin, the screen composes the sections, and the sections hand
 * rows straight to the Table. None of the three opens a `Link`, so there is no
 * anchor anywhere above a table cell for a user-agent colour to come down
 * from. (Confirmed against `expo export --platform web`: the exported
 * /progress page contains no `<a` element at all.)
 */
describe('the Progress route puts no anchor above a table', () => {
  const files = [
    '../../../app/(tabs)/progress.tsx',
    './screen.tsx',
    './sections.tsx',
    './climbSections.tsx',
    './ledger.tsx',
  ];

  it('opens no Link on the way to a table cell', () => {
    for (const file of files) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect([file, LINK_OPEN.test(source)]).toEqual([file, false]);
      LINK_OPEN.lastIndex = 0;
    }
  });
});
