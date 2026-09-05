/**
 * The QA screenshot matrix: every route, at three widths, in both schemes.
 *
 * It waits for the route's own words rather than for a fixed number of seconds.
 * A cold profile spends about 25 s opening sql.js, migrating and seeding the
 * fixture, and a timer set short enough to feel pleasant captures the boot
 * skeleton instead of the screen, which is exactly how a working app came to be
 * reported as frozen.
 *
 * The browser is driven straight over the DevTools protocol (see `cdp.mjs`):
 * node only, no dependency, and nothing in between that can hang.
 *
 * One flag needs explaining. `--timezone` overrides the zone the page reports,
 * and a run started between midnight and the fixture athlete's rollover hour
 * needs it: the seed stamps the fixture on the calendar day (there is no stored
 * athlete yet, so the rollover is 0) and the app then reads its own day back
 * through the seeded rollover of 3, which is still yesterday. Today comes up as
 * the rest day, with no set row to tap. A zone whose local clock is already
 * past the rollover puts the two back in step.
 *
 * Usage:
 *   node scripts/qa-shots.mjs [--base http://localhost:8081] [--out <dir>]
 *                             [--routes today,plan] [--widths 390,1280]
 *                             [--schemes light,dark] [--timezone UTC]
 *                             [--no-interaction]
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, sleep } from './cdp.mjs';

/* ------------------------------------------------------------------ config */

const SCRATCH = join(
  tmpdir(),
  'claude',
  'C--Users-nonot-vertical-jump',
  '9c379790-0511-427f-b1b5-eb959a7c5ca1',
  'scratchpad',
);

const DEFAULTS = {
  base: 'http://localhost:8081',
  out: join(SCRATCH, 'shots', 'final'),
  port: 9422,
  /** null follows the machine. See the note above about the rollover hour. */
  timezone: null,
  /** How long a route gets to put its own words on screen. */
  readyTimeoutMs: 45_000,
  pollMs: 500,
  /** Tallest full-page capture, in CSS pixels. */
  maxFullHeight: 6000,
};

/**
 * Each route's own phrase, matched case-insensitively: section labels render
 * through `text-transform: uppercase`, and `innerText` is the rendered text, so
 * "Athlete" reaches the DOM as "ATHLETE".
 *
 * `full` marks the three screens that are read by scrolling, so they are worth
 * a second capture of the whole column.
 */
const ROUTES = [
  { slug: 'today', path: '/', phrases: ['Soreness today', 'Rest is prescribed'], full: true },
  { slug: 'plan', path: '/plan', phrases: ['Week 7'], full: true },
  { slug: 'progress', path: '/progress', phrases: ['Trend'], full: true },
  { slug: 'settings', path: '/settings', phrases: ['Athlete'] },
  { slug: 'settings-whoop', path: '/settings/whoop', phrases: ['Data by WHOOP'] },
  { slug: 'setup-gate', path: '/setup/gate', phrases: ['Medical self-screen'] },
  { slug: 'setup-two', path: '/setup/two', phrases: ['Jump inputs'] },
  {
    slug: 'clearance',
    path: '/clearance?state=severe_pain&location=knee',
    phrases: ['Medical clearance'],
  },
  { slug: 'dev-kit', path: '/dev/kit', phrases: ['UI kit'] },
  { slug: 'dev-charts', path: '/dev/charts', phrases: ['Charts'] },
];

/** Phone, tablet, desktop. The scale factor is the one the device really has. */
const WIDTHS = [
  { width: 390, height: 844, deviceScaleFactor: 2 },
  { width: 834, height: 1194, deviceScaleFactor: 2 },
  { width: 1280, height: 800, deviceScaleFactor: 1 },
];

const SCHEMES = ['light', 'dark'];

/* -------------------------------------------------------------------- args */

function parseArgs(argv) {
  const options = { ...DEFAULTS, interaction: true, routes: null, widths: null, schemes: null };
  const take = (index) => argv[index + 1];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = take(i);
    if (value === undefined && flag !== '--no-interaction') continue;
    if (flag === '--base') { options.base = value; i += 1; }
    else if (flag === '--out') { options.out = value; i += 1; }
    else if (flag === '--port') { options.port = Number(value); i += 1; }
    else if (flag === '--timezone') { options.timezone = value; i += 1; }
    else if (flag === '--routes') { options.routes = value.split(','); i += 1; }
    else if (flag === '--widths') { options.widths = value.split(',').map(Number); i += 1; }
    else if (flag === '--schemes') { options.schemes = value.split(','); i += 1; }
    else if (flag === '--no-interaction') options.interaction = false;
  }
  return options;
}

/* ------------------------------------------------------------------ matrix */

async function captureRoute(page, route, viewport, scheme, options, report) {
  const name = `${route.slug}-${viewport.width}-${scheme}`;
  const shot = await page.capture(name);
  report.files.push({ name: `${name}.png`, bytes: shot.bytes });

  if (route.full !== true) return;

  const measured = Math.round((await page.contentHeight()) || viewport.height);
  const height = Math.max(Math.min(measured, options.maxFullHeight), viewport.height);
  await page.setViewport({ ...viewport, height });
  await sleep(700);
  const full = await page.capture(`${name}-full`, {
    x: 0,
    y: 0,
    width: viewport.width,
    height,
    scale: 1,
  });
  report.files.push({ name: `${name}-full.png`, bytes: full.bytes, height });
  await page.setViewport(viewport);
  await sleep(300);
}

async function runScheme(cdp, scheme, options, report) {
  const page = await cdp.newPage(options.out);
  await page.setScheme(scheme);
  if (options.timezone !== null) await page.setTimezone(options.timezone);

  const widths = options.widths === null
    ? WIDTHS
    : WIDTHS.filter((entry) => options.widths.includes(entry.width));
  const routes = options.routes === null
    ? ROUTES
    : ROUTES.filter((entry) => options.routes.includes(entry.slug));

  for (const route of routes) {
    const separator = route.path.includes('?') ? '&' : '?';
    const url = `${options.base}${route.path}${separator}theme=${scheme}`;
    let navigated = false;

    for (const viewport of widths) {
      await page.setViewport(viewport);
      if (navigated) {
        // A resize is a re-render, not a reload: useWindowDimensions moves the
        // layout across the breakpoints without paying the boot cost again.
        await sleep(900);
      } else {
        await page.navigate(url);
        navigated = true;
      }

      const before = page.consoleErrors.length;
      let ready = await page.waitForText(route.phrases, options.readyTimeoutMs, options.pollMs);
      if (!ready.ok) {
        // A resize that lost the phrase is worth one reload before giving up.
        await page.navigate(url);
        ready = await page.waitForText(route.phrases, options.readyTimeoutMs, options.pollMs);
      }
      if (!ready.ok) {
        report.missing.push({
          route: route.slug,
          width: viewport.width,
          scheme,
          excerpt: ready.text.replace(/\s+/g, ' ').slice(0, 300),
        });
        continue;
      }

      await sleep(600);
      await captureRoute(page, route, viewport, scheme, options, report);
      for (const error of page.consoleErrors.slice(before)) {
        report.errors.push(`${route.slug} ${viewport.width} ${scheme}: ${error}`);
      }
      process.stdout.write(`  ${route.slug} ${viewport.width} ${scheme}\n`);
    }
  }
}

/* ------------------------------------------------------------- interaction */

/**
 * The first set row on Today. The whole row is the log control and the Edit
 * target is absolutely positioned inside it, which is why the click lands at
 * 30 percent of the width rather than at the centre.
 */
const FIRST_SET_ROW = `(() => {
  const row = document.querySelector('[data-testid^="set-"] [role="button"]');
  if (row === null) return null;
  row.scrollIntoView({ block: 'center' });
  const box = row.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height,
           label: row.getAttribute('aria-label') };
})()`;

async function runInteraction(cdp, options, report) {
  const viewport = WIDTHS[0];
  const page = await cdp.newPage(options.out);
  await page.setScheme('light');
  if (options.timezone !== null) await page.setTimezone(options.timezone);
  await page.setViewport(viewport);
  await page.navigate(`${options.base}/?theme=light`);

  const fail = (excerpt) => {
    report.missing.push({ route: 'today (interaction)', width: viewport.width, scheme: 'light', excerpt });
  };

  const ready = await page.waitForText(['Soreness today'], options.readyTimeoutMs, options.pollMs);
  if (!ready.ok) {
    fail(ready.text.replace(/\s+/g, ' ').slice(0, 300));
    return;
  }
  await sleep(600);

  const box = await page.evaluate(FIRST_SET_ROW);
  if (box === null) {
    fail('no element matched [data-testid^="set-"] [role="button"]');
    return;
  }
  report.interaction.push(`first set row: ${box.label ?? '(no aria-label)'}`);

  await page.clickBox(box);
  await sleep(1000);
  const tapped = await page.capture('today-390-light-after-tap');
  report.files.push({ name: 'today-390-light-after-tap.png', bytes: tapped.bytes });
  const afterTap = (await page.text()) ?? '';
  report.interaction.push(`after tap: rest bar ${afterTap.includes('Skip rest') ? 'present' : 'MISSING'}`);
  report.interaction.push(`after tap: row reads "${(await page.evaluate(FIRST_SET_ROW))?.label ?? '?'}"`);

  await page.clickBox((await page.evaluate(FIRST_SET_ROW)) ?? box);
  await sleep(1000);
  const undone = await page.capture('today-390-light-after-undo');
  report.files.push({ name: 'today-390-light-after-undo.png', bytes: undone.bytes });
  const afterUndo = (await page.text()) ?? '';
  report.interaction.push(`after undo: rest bar ${afterUndo.includes('Skip rest') ? 'STILL PRESENT' : 'gone'}`);
  report.interaction.push(`after undo: row reads "${(await page.evaluate(FIRST_SET_ROW))?.label ?? '?'}"`);

  for (const error of page.consoleErrors) report.errors.push(`interaction: ${error}`);
}

/* ------------------------------------------------------------------ report */

function printReport(report, options, elapsedMs) {
  const total = report.files.reduce((sum, file) => sum + file.bytes, 0);
  const kb = (bytes) => String(Math.round(bytes / 1024)).padStart(5);
  process.stdout.write(
    `\nwrote ${report.files.length} files, ${Math.round(total / 1024)} KB, ` +
      `in ${Math.round(elapsedMs / 1000)} s, to ${options.out}\n\n`,
  );
  for (const file of [...report.files].sort((a, b) => a.name.localeCompare(b.name))) {
    const tall = file.height === undefined ? '' : `  (${file.height} css px tall)`;
    process.stdout.write(`  ${file.name.padEnd(38)} ${kb(file.bytes)} KB${tall}\n`);
  }
  if (report.interaction.length > 0) {
    process.stdout.write('\ninteraction:\n');
    for (const line of report.interaction) process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write(`\nroutes whose text never appeared: ${report.missing.length}\n`);
  for (const miss of report.missing) {
    process.stdout.write(`  ${miss.route} ${miss.width} ${miss.scheme}: "${miss.excerpt}"\n`);
  }
  const errors = [...new Set(report.errors)];
  process.stdout.write(`\nconsole errors: ${errors.length}\n`);
  for (const error of errors.slice(0, 30)) process.stdout.write(`  ${error}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });

  const report = { files: [], missing: [], errors: [], interaction: [] };
  const started = Date.now();
  const browser = await launchBrowser({
    port: options.port,
    profile: join(SCRATCH, 'qa-shots-profile'),
  });

  try {
    for (const scheme of options.schemes ?? SCHEMES) {
      process.stdout.write(`\n== ${scheme} ==\n`);
      await runScheme(browser.cdp, scheme, options, report);
    }
    if (options.interaction) {
      process.stdout.write('\n== interaction ==\n');
      await runInteraction(browser.cdp, options, report);
    }
  } finally {
    browser.close();
  }

  printReport(report, options, Date.now() - started);
  process.exit(report.missing.length === 0 ? 0 : 2);
}

main().catch((error) => {
  process.stderr.write(`qa-shots failed: ${String(error)}\n`);
  process.exit(1);
});
