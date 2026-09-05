import type { SqlExecutor } from '../executor';
import type { ImportBatch, Json } from '../types';
import { fromJson, newId, nowIso, oneOf, toJson } from './rows';

/**
 * OVR Connect exports are always full history, so the file hash is the
 * idempotency key: re-importing the same export is a no-op, and the preview
 * counts are stored on the batch so Confirm shows what Cancel would have.
 */

const STATUSES = ['preview', 'committed', 'cancelled'] as const;

interface BatchRow {
  readonly id: string;
  readonly file_hash: string;
  readonly file_name: string | null;
  readonly type: string;
  readonly exporter_version: string | null;
  readonly schema_version: string | null;
  readonly row_count: number;
  readonly mapping: string | null;
  readonly counts: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly committed_at: string | null;
}

function mapBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    fileHash: row.file_hash,
    fileName: row.file_name,
    type: row.type,
    exporterVersion: row.exporter_version,
    schemaVersion: row.schema_version,
    rowCount: row.row_count,
    mapping: fromJson(row.mapping),
    counts: fromJson(row.counts),
    status: oneOf(row.status, STATUSES, 'preview'),
    createdAt: row.created_at,
    committedAt: row.committed_at,
  };
}

export interface StartImportInput {
  readonly fileHash: string;
  readonly fileName?: string | null;
  readonly type: string;
  readonly exporterVersion?: string | null;
  readonly schemaVersion?: string | null;
  readonly rowCount?: number;
  readonly mapping?: Json;
  readonly counts?: Json;
}

export interface StartImportResult {
  readonly batch: ImportBatch;
  /** False when this exact file has already been imported. Nothing was written. */
  readonly isNew: boolean;
}

export async function startImport(
  db: SqlExecutor,
  input: StartImportInput,
): Promise<StartImportResult> {
  const existing = await getImportByHash(db, input.fileHash);
  if (existing !== null) return { batch: existing, isNew: false };

  const id = newId('imp');
  await db.runAsync(
    `INSERT INTO import_batch
       (id, file_hash, file_name, type, exporter_version, schema_version, row_count,
        mapping, counts, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'preview', ?)
     ON CONFLICT(file_hash) DO NOTHING`,
    [
      id,
      input.fileHash,
      input.fileName ?? null,
      input.type,
      input.exporterVersion ?? null,
      input.schemaVersion ?? null,
      input.rowCount ?? 0,
      toJson(input.mapping),
      toJson(input.counts),
      nowIso(),
    ],
  );

  const batch = await getImportByHash(db, input.fileHash);
  if (batch === null) throw new Error('startImport: the import batch did not save.');
  return { batch, isNew: true };
}

export async function getImportByHash(
  db: SqlExecutor,
  fileHash: string,
): Promise<ImportBatch | null> {
  const row = await db.getFirstAsync<BatchRow>('SELECT * FROM import_batch WHERE file_hash = ?', [
    fileHash,
  ]);
  return row === null ? null : mapBatch(row);
}

export async function getImport(db: SqlExecutor, batchId: string): Promise<ImportBatch | null> {
  const row = await db.getFirstAsync<BatchRow>('SELECT * FROM import_batch WHERE id = ?', [batchId]);
  return row === null ? null : mapBatch(row);
}

export async function listImports(db: SqlExecutor, limit = 20): Promise<ImportBatch[]> {
  const rows = await db.getAllAsync<BatchRow>(
    'SELECT * FROM import_batch ORDER BY created_at DESC LIMIT ?',
    [Math.max(1, Math.floor(limit))],
  );
  return rows.map(mapBatch);
}

/** Nothing is committed until the preview is confirmed. */
export async function commitImport(
  db: SqlExecutor,
  batchId: string,
  counts?: Json,
): Promise<ImportBatch> {
  await db.runAsync(
    "UPDATE import_batch SET status = 'committed', committed_at = ?, counts = COALESCE(?, counts) WHERE id = ?",
    [nowIso(), toJson(counts), batchId],
  );
  const batch = await getImport(db, batchId);
  if (batch === null) throw new Error(`commitImport: no import batch ${batchId}.`);
  return batch;
}

export async function cancelImport(db: SqlExecutor, batchId: string): Promise<void> {
  await db.runAsync("UPDATE import_batch SET status = 'cancelled' WHERE id = ?", [batchId]);
}

export async function setImportMapping(
  db: SqlExecutor,
  batchId: string,
  mapping: Json,
): Promise<void> {
  await db.runAsync('UPDATE import_batch SET mapping = ? WHERE id = ?', [toJson(mapping), batchId]);
}
