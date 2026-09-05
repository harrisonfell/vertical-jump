/**
 * The export.
 *
 * Two things are worth pinning: the quoting, because a note with a comma in it
 * is the first thing that breaks a hand-rolled CSV, and the display columns,
 * because they are transcribed from the engine rather than imported and would
 * otherwise be free to drift.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as exportRoute } from '../src/app/api/export/route';
import type { Database } from '../src/db/client';
import { deviceSecret } from '../src/db/tables/account';
import {
  athlete,
  jumpRep,
  jumpTestSession,
  readinessTestSession,
  session,
  sessionEvent,
  setLog,
  week,
} from '../src/db/tables/mirror';
import { sessionWorkoutLink, whoopRecovery, whoopWorkout } from '../src/db/tables/whoop';
import type { ExportManifest } from '../src/lib/api-contract';
import { hashSecret } from '../src/lib/crypto';
import { csvCell, displayLoadLb, formatHeightValueIn, localDayIn, toCsv } from '../src/lib/export/csv';
import { readExportSource, readinessCsv, sessionsCsv, whoopCsv } from '../src/lib/export/rows';
import { bodyOf, harness, request, teardown } from './support/harness';

/**
 * `<deviceId>.<random>`: the id in front of the dot is how the row is found,
 * so a bearer costs one scrypt rather than one per paired device.
 */
const SECRET = 'dev_test.a-device-secret-long-enough-to-pass-the-contract';
const NOW = new Date('2026-09-05T12:00:00.000Z');

let db: Database;

beforeEach(async () => {
  db = await harness();
  await db.insert(deviceSecret).values({
    id: 'dev_test',
    name: 'iPhone',
    secretHash: hashSecret(SECRET),
    pairedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
}, 60_000);

afterEach(() => {
  teardown();
});

async function seed(): Promise<void> {
  await db.insert(athlete).values({
    id: 'athlete_owner',
    timezone: 'America/New_York',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    serverUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
  });

  await db.insert(jumpTestSession).values({
    id: 'test-1',
    athleteId: 'athlete_owner',
    localDate: '2026-09-03',
    performedAt: '2026-09-03T17:00:00.000Z',
    instrument: 'ovr_jump_regular',
    // A note that needs every quoting rule at once.
    notes: 'felt "good", but heavy\nsecond line',
    createdAt: '2026-09-03T17:00:00.000Z',
    updatedAt: '2026-09-03T17:00:00.000Z',
  });
  await db.insert(jumpRep).values([
    { id: 'rep-1', jumpTestSessionId: 'test-1', attemptIndex: 1, heightMm: 826, createdAt: 'x' },
    { id: 'rep-2', jumpTestSessionId: 'test-1', attemptIndex: 2, heightMm: 813, createdAt: 'x' },
  ]);

  await db.insert(week).values({
    id: 'week-7',
    programId: 'program-1',
    w: 7,
    windowStart: '2026-10-19',
    windowEnd: '2026-10-25',
    kind: 'load',
  });

  await db.insert(session).values([
    {
      id: 'session-done',
      programId: 'program-1',
      weekId: 'week-7',
      scheduledDate: '2026-09-03',
      dayType: 'Lower Strength',
      createdAt: 'x',
      updatedAt: 'x',
    },
    {
      id: 'session-open',
      programId: 'program-1',
      weekId: 'week-7',
      scheduledDate: '2026-09-04',
      dayType: 'Power + Speed',
      createdAt: 'x',
      updatedAt: 'x',
    },
    {
      id: 'session-missed',
      programId: 'program-1',
      weekId: 'week-7',
      scheduledDate: '2026-09-02',
      dayType: 'Upper Strength',
      createdAt: 'x',
      updatedAt: 'x',
    },
    {
      id: 'session-planned',
      programId: 'program-1',
      weekId: 'week-7',
      scheduledDate: '2026-09-30',
      dayType: 'Recovery - Mobility',
      createdAt: 'x',
      updatedAt: 'x',
    },
  ]);

  await db.insert(sessionEvent).values([
    { id: 'ev-1', sessionId: 'session-done', kind: 'start', at: '2026-09-03T17:00:00.000Z', createdAt: 'x' },
    {
      id: 'ev-2',
      sessionId: 'session-done',
      kind: 'complete',
      at: '2026-09-03T18:10:00.000Z',
      createdAt: 'x',
    },
    // An undone finish stops counting, so this session is not done.
    { id: 'ev-3', sessionId: 'session-open', kind: 'complete', at: '2026-09-04T18:00:00.000Z', createdAt: 'x' },
    {
      id: 'ev-4',
      sessionId: 'session-open',
      kind: 'uncomplete',
      at: '2026-09-04T18:05:00.000Z',
      createdAt: 'x',
    },
  ]);

  await db.insert(setLog).values([
    {
      id: 'log-1',
      sessionId: 'session-done',
      sessionExerciseId: 'ex-1',
      setNumber: 1,
      repsDone: 5,
      loadKg: 93,
      completedAt: '2026-09-03T17:20:00.000Z',
      idempotencyKey: 'ex-1:1',
      createdAt: 'x',
    },
    {
      id: 'log-2',
      sessionId: 'session-open',
      sessionExerciseId: 'ex-2',
      setNumber: 1,
      repsDone: 3,
      completedAt: '2026-09-04T17:20:00.000Z',
      idempotencyKey: 'ex-2:1',
      createdAt: 'x',
    },
  ]);

  await db
    .insert(sessionWorkoutLink)
    .values({
      sessionId: 'session-done',
      whoopWorkoutId: 'wko-1',
      matchSource: 'auto',
      overlapS: 3600,
      linkedAt: '2026-09-03T19:00:00.000Z',
      updatedAt: new Date('2026-09-03T19:00:00.000Z'),
    });

  await db.insert(whoopRecovery).values([
    {
      id: 'rec-1',
      scoreState: 'SCORED',
      userCalibrating: false,
      recoveryScore: 71,
      restingHeartRate: 48,
      hrvRmssdMilli: 92.4187,
      localDate: '2026-09-03',
      raw: {},
      updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    },
    {
      id: 'rec-2',
      scoreState: 'PENDING_SCORE',
      localDate: '2026-09-04',
      raw: {},
      updatedAt: new Date('2026-09-04T11:00:00.000Z'),
    },
  ]);
  await db.insert(whoopWorkout).values({
    id: 'wko-1',
    scoreState: 'SCORED',
    sportName: 'Weightlifting',
    startAt: '2026-09-03T17:00:00.000Z',
    endAt: '2026-09-03T18:10:00.000Z',
    strain: 8.4372,
    localDate: '2026-09-03',
    raw: {},
    updatedAt: new Date('2026-09-03T19:00:00.000Z'),
  });
}

describe('csv writing', () => {
  it('quotes only the fields that have to be quoted', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has, comma')).toBe('"has, comma"');
    expect(csvCell('has "quote"')).toBe('"has ""quote"""');
    expect(csvCell('has\nbreak')).toBe('"has\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(false)).toBe('false');
  });

  it('ends every record with CRLF, including the last', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2\r\n');
    expect(toCsv(['a'], [])).toBe('a\r\n');
  });
});

describe('the display columns', () => {
  it('matches the engine on the numbers the app shows', () => {
    // 32.5 in, the fixture's canonical height, and the brief's "5 x 205 lb".
    expect(formatHeightValueIn(825.5)).toBe('32.5');
    expect(formatHeightValueIn(813)).toBe('32.0');
    expect(displayLoadLb(93)).toBe(205);
    expect(displayLoadLb(124.7)).toBe(275);
  });

  it('stamps the export with the athlete day, not the server day', () => {
    // 02:00 UTC is still the day before in New York.
    expect(localDayIn('America/New_York', new Date('2026-09-05T02:00:00.000Z'))).toBe('2026-09-04');
    expect(localDayIn('UTC', new Date('2026-09-05T02:00:00.000Z'))).toBe('2026-09-05');
    expect(localDayIn('Not/AZone', new Date('2026-09-05T02:00:00.000Z'))).toBe('2026-09-05');
  });
});

describe('the manifest', () => {
  it('names every file, counts its rows, and links to it', async () => {
    await seed();
    const response = await exportRoute(request('/api/export?format=csv', { bearer: SECRET }));
    expect(response.status).toBe(200);
    const manifest = await bodyOf<ExportManifest>(response);

    expect(manifest.files.map((file) => file.name)).toEqual([
      'tests',
      'set-logs',
      'sessions',
      'weeks',
      'whoop',
      'readiness',
    ]);
    expect(manifest.files.find((file) => file.name === 'tests')?.rowCount).toBe(2);
    expect(manifest.files.find((file) => file.name === 'set-logs')?.rowCount).toBe(2);
    expect(manifest.files.find((file) => file.name === 'sessions')?.rowCount).toBe(4);
    expect(manifest.files.find((file) => file.name === 'weeks')?.rowCount).toBe(1);
    expect(manifest.files.find((file) => file.name === 'whoop')?.rowCount).toBe(3);
    // The readiness gate's own stream: nothing seeded here, so it is empty
    // rather than absent (`house.sc.readiness_gate`).
    expect(manifest.files.find((file) => file.name === 'readiness')?.rowCount).toBe(0);
    expect(manifest.files[0]?.href).toBe('/api/export?format=csv&file=tests');
  });
});

describe('the readiness file', () => {
  it('writes one row a test, with the attempts beside the day number', async () => {
    await seed();
    await db.insert(readinessTestSession).values({
      id: 'rt-1',
      athleteId: 'athlete_owner',
      localDate: '2026-10-22',
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: [6.95, 7.05, 7.15],
      best: 7.15,
      unit: 'm',
      createdAt: '2026-10-22T17:30:00.000Z',
    });

    const source = await readExportSource(db, NOW);
    expect(source.readiness).toHaveLength(1);
    const csv = readinessCsv(source.readiness);
    const lines = csv.split(String.fromCharCode(13, 10));
    expect(lines[0]).toBe(
      'id,local_date,kind,metric,unit,best,attempts,entry_source,created_at',
    );
    expect(lines[1]).toBe(
      'rt-1,2026-10-22,seated_mb_throw,distance_m,m,7.15,"[6.95,7.05,7.15]",typed,2026-10-22T17:30:00.000Z',
    );
  });
});

describe('the files', () => {
  it('writes one row per jump attempt with the height in inches beside the millimetres', async () => {
    await seed();
    const response = await exportRoute(request('/api/export?format=csv&file=tests', { bearer: SECRET }));
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('vert-tests-');

    const text = await response.text();
    const lines = text.split('\r\n');
    expect(lines[0]).toBe(
      'test_id,local_date,performed_at,instrument,mode,canonical,is_baseline,scheduled,' +
        'box_height_mm,bodyweight_kg,device_firmware,connect_version,notes,attempt,height_mm,' +
        'height_in,gct_ms,rsi_calc,rsi_device,flagged,reject_reason,entry_source,import_batch_id',
    );
    // The note holds a comma, a quote, and a line break, so the record is quoted
    // and the file is longer than its record count.
    expect(text).toContain('"felt ""good"", but heavy\nsecond line"');
    expect(text).toContain(',826,32.5,');
    expect(text).toContain(',813,32.0,');
  });

  it('writes the load in pounds beside the kilograms', async () => {
    await seed();
    const response = await exportRoute(
      request('/api/export?format=csv&file=set-logs', { bearer: SECRET }),
    );
    const text = await response.text();
    expect(text.split('\r\n')[0]).toContain('load_kg,load_lb');
    expect(text).toContain(',93,205,');
  });

  it('derives session status the way the phone does', async () => {
    await seed();
    const source = await readExportSource(db, NOW);
    const rows = sessionsCsv(source.sessions).split('\r\n');
    const statusOf = (id: string): string | undefined =>
      rows.find((line) => line.startsWith(`${id},`))?.split(',')[5];

    expect(statusOf('session-done')).toBe('done');
    expect(statusOf('session-open')).toBe('not_finished');
    expect(statusOf('session-missed')).toBe('missed');
    expect(statusOf('session-planned')).toBe('planned');

    const done = source.sessions.find((row) => row.id === 'session-done');
    expect(done?.startedAt).toBe('2026-09-03T17:00:00.000Z');
    expect(done?.markedCompleteAt).toBe('2026-09-03T18:10:00.000Z');
    expect(done?.whoopWorkoutId).toBe('wko-1');
    // The finish was undone, so it is not a finish.
    expect(source.sessions.find((row) => row.id === 'session-open')?.markedCompleteAt).toBeNull();
  });

  it('keeps a pending Whoop score as an empty cell, never as a zero', async () => {
    await seed();
    const source = await readExportSource(db, NOW);
    const lines = whoopCsv(source.recovery, source.workouts).split('\r\n');
    const pending = lines.find((line) => line.startsWith('recovery,rec-2,'));
    // `user_calibrating` is a gap too: an unscored recovery carries no score
    // object at all, so "not calibrating" is not something anyone knows yet.
    expect(pending).toBe('recovery,rec-2,2026-09-04,PENDING_SCORE,,,,,,,,,,,');

    const scored = lines.find((line) => line.startsWith('recovery,rec-1,'));
    expect(scored).toContain('SCORED,false,71,48,92.42');
  });
});

describe('the JSON document', () => {
  it('is the restorable copy, with its units named', async () => {
    await seed();
    const response = await exportRoute(request('/api/export', { bearer: SECRET }));
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('content-disposition')).toContain('vert-export-');

    const document = JSON.parse(await response.text()) as {
      exportedOn: string;
      units: Record<string, string>;
      tests: { reps: unknown[] }[];
      sessions: unknown[];
      setLogs: unknown[];
      weeks: unknown[];
      whoop: { recovery: unknown[]; workouts: unknown[] };
    };

    expect(document.units).toEqual({ height: 'mm', load: 'kg', duration: 's', velocity: 'm/s' });
    expect(document.exportedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(document.tests[0]?.reps).toHaveLength(2);
    expect(document.sessions).toHaveLength(4);
    expect(document.setLogs).toHaveLength(2);
    expect(document.weeks).toHaveLength(1);
    expect(document.whoop.recovery).toHaveLength(2);
    expect(document.whoop.workouts).toHaveLength(1);
  });

  it('exports an empty database as headers with no rows', async () => {
    const response = await exportRoute(
      request('/api/export?format=csv&file=weeks', { bearer: SECRET }),
    );
    expect(await response.text()).toBe(
      'week_id,program_id,w,window_start,window_end,kind,k,prescribed_count,completed_count,' +
        'adherence_pct,all_reps_completed,outcome,repeat_of_week,high_contact_allowance,' +
        'extensive_target,generated_at\r\n',
    );
  });

  it('refuses a caller with no credential', async () => {
    const response = await exportRoute(request('/api/export'));
    expect(response.status).toBe(401);
  });

  it('refuses a file name it does not have', async () => {
    const response = await exportRoute(
      request('/api/export?format=csv&file=everything', { bearer: SECRET }),
    );
    expect(response.status).toBe(400);
  });
});
