import { NextResponse } from 'next/server';

/**
 * Liveness only. It never touches the database, so it answers during a Neon
 * cold start and during a deploy, which is what a health check is for.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
