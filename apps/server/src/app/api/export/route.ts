import type { NextRequest } from 'next/server';
import { exportQuery } from '../../../lib/api-contract';
import { exportCsv, exportJson, exportManifestFor } from '../../../lib/export';
import { database } from '../../../lib/routes/db';
import { guard } from '../../../lib/routes/guard';
import { badRequest, json, textFile } from '../../../lib/routes/respond';

/**
 * The backup, taken from a browser.
 *
 * `format=json` is the restorable copy; `format=csv&file=<name>` is one
 * spreadsheet; `format=csv` with no file is the manifest, so a page can list
 * what there is and how many rows each holds before downloading anything.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const url = new URL(request.url);
  const parsed = exportQuery.safeParse({
    format: url.searchParams.get('format') ?? undefined,
    file: url.searchParams.get('file') ?? undefined,
  });
  if (!parsed.success) return badRequest('The export takes format=csv or format=json.');

  if (parsed.data.format === 'csv') {
    if (parsed.data.file === undefined) return json(await exportManifestFor(db));
    const file = await exportCsv(db, parsed.data.file);
    return textFile(file.text, file.mime, file.name);
  }

  const document = await exportJson(db);
  return textFile(document.text, document.mime, document.name);
}
