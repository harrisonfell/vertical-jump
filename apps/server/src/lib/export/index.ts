/**
 * The export, built server-side.
 *
 * Same five CSVs and one JSON the phone's Settings screen builds, from the
 * server's copy of the same tables, so a laptop can take the backup when the
 * phone is not to hand. The manifest is what a browser sees first: it names
 * every file, counts its rows, and links to it, so nothing has to be guessed
 * from a query string.
 */

import type { Database } from '../../db/client';
import type { ExportFileName, ExportManifest } from '../api-contract';
import { API } from '../api-contract';
import {
  exportDocument,
  readExportSource,
  sessionsCsv,
  setLogsCsv,
  testsCsv,
  readinessCsv,
  weeksCsv,
  whoopCsv,
  type ExportSource,
} from './rows';

export interface ExportFile {
  readonly name: string;
  readonly mime: 'text/csv' | 'application/json';
  readonly text: string;
  /** What the row in Settings calls it. */
  readonly label: string;
  readonly rowCount: number;
}

/** Stamped into the JSON so a future importer knows the shape it is reading. */
export const EXPORT_APP_VERSION = 'server-0.1.0';

export const FILE_LABELS: Readonly<Record<ExportFileName, string>> = {
  tests: 'Jump tests',
  'set-logs': 'Set logs',
  sessions: 'Sessions',
  weeks: 'Weeks',
  whoop: 'Whoop mirrors',
  readiness: 'Readiness tests',
};

function attemptCount(source: ExportSource): number {
  return source.tests.reduce((total, test) => total + test.reps.length, 0);
}

function rowCountFor(source: ExportSource, file: ExportFileName): number {
  switch (file) {
    case 'tests':
      return attemptCount(source);
    case 'set-logs':
      return source.setLogs.length;
    case 'sessions':
      return source.sessions.length;
    case 'weeks':
      return source.weeks.length;
    case 'whoop':
      return source.recovery.length + source.workouts.length;
    case 'readiness':
      return source.readiness.length;
  }
}

function csvFor(source: ExportSource, file: ExportFileName): string {
  switch (file) {
    case 'tests':
      return testsCsv(source.tests);
    case 'set-logs':
      return setLogsCsv(source.setLogs);
    case 'sessions':
      return sessionsCsv(source.sessions);
    case 'weeks':
      return weeksCsv(source.weeks);
    case 'whoop':
      return whoopCsv(source.recovery, source.workouts);
    case 'readiness':
      return readinessCsv(source.readiness);
  }
}

const FILES: readonly ExportFileName[] = [
  'tests',
  'set-logs',
  'sessions',
  'weeks',
  'whoop',
  'readiness',
];

/** What GET /api/export lists when no file is named. */
export async function exportManifestFor(
  db: Database,
  now: Date = new Date(),
): Promise<ExportManifest> {
  const source = await readExportSource(db, now);
  return {
    exportedOn: source.today,
    files: FILES.map((name) => ({
      name,
      label: FILE_LABELS[name],
      rowCount: rowCountFor(source, name),
      href: `${API.exportData}?format=csv&file=${name}`,
    })),
  };
}

/** One CSV, with the file name the phone would have given it. */
export async function exportCsv(
  db: Database,
  file: ExportFileName,
  now: Date = new Date(),
): Promise<ExportFile> {
  const source = await readExportSource(db, now);
  return {
    name: `vert-${file}-${source.today}.csv`,
    mime: 'text/csv',
    text: csvFor(source, file),
    label: FILE_LABELS[file],
    rowCount: rowCountFor(source, file),
  };
}

/** Everything, as the one restorable JSON document. */
export async function exportJson(db: Database, now: Date = new Date()): Promise<ExportFile> {
  const source = await readExportSource(db, now);
  return {
    name: `vert-export-${source.today}.json`,
    mime: 'application/json',
    text: exportDocument(source, EXPORT_APP_VERSION),
    label: 'Everything, as JSON',
    rowCount:
      attemptCount(source) + source.setLogs.length + source.sessions.length + source.weeks.length,
  };
}

export { readExportSource, type ExportSource } from './rows';
