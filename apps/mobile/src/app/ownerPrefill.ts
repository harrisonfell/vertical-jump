import { useQuery, useQueryClient } from '@tanstack/react-query';
// Deep imports on purpose: the data barrel pulls every hook in behind it, and
// this module is reached from the gate on every boot.
import { useDbOrNull, useTimezone, useToday } from '@/data/db';
import type { SqlExecutor } from '@/data/executor';
import { queryKeys } from '@/data/hooks/keys';
import { isAthleteEmpty, upsertAthlete } from '@/data/store/athlete';
import { nowIso } from '@/data/store/rows';
import { ownerAthletePatch } from '@/features/setup/ownerPrefill';

/**
 * `EXPO_PUBLIC_OWNER=1`: the owner's saved profile, written once at boot.
 *
 * It writes the athlete row and nothing else. No program, no sessions, no set
 * logs, no jump tests, no Whoop mirrors: the owner asked for a clean start
 * with their answers already in, not for a demo. Setup still stops at step 2
 * because the baseline and the goal are the owner's to type, and nothing is
 * built until they tap Build program.
 *
 * It only ever runs against an empty athlete table, so a real profile is never
 * overwritten, and it is separate from the fixture seed on purpose: the two
 * flags mean different things and neither implies the other.
 */

export function ownerMode(value: string | undefined = process.env.EXPO_PUBLIC_OWNER): boolean {
  return value === '1';
}

/**
 * Write the profile if the store has no athlete yet.
 *
 * @returns true when the row was written, false when it was already there or
 *   the flag is off.
 */
export async function prefillOwnerIfEmpty(
  db: SqlExecutor,
  today: string,
  timezone: string,
  enabled: boolean = ownerMode(),
): Promise<boolean> {
  if (!enabled) return false;
  if (!(await isAthleteEmpty(db))) return false;
  await upsertAthlete(db, ownerAthletePatch(today, timezone, nowIso()));
  return true;
}

export interface OwnerPrefillState {
  /** False only while the write is still in flight, so the gate can wait. */
  readonly settled: boolean;
}

/**
 * The boot write, as a query the gate can wait on.
 *
 * Waiting matters: without it the gate reads an empty athlete table, sends the
 * owner to the self-screen, and the redirect is undone a frame later when the
 * row lands. One skeleton is better than two redirects.
 *
 * The setup screens wait on it for a second reason and start it themselves.
 * They seed their fields once, from the row, and a form that opens beside an
 * unwritten row keeps the blanks it opened with; the gate is nowhere on the
 * path when a setup URL is opened directly, so it cannot do the write for
 * them.
 */
export function useOwnerPrefill(): OwnerPrefillState {
  const db = useDbOrNull();
  const today = useToday();
  const timezone = useTimezone();
  const client = useQueryClient();
  const enabled = ownerMode();

  const query = useQuery({
    queryKey: ['ownerPrefill', today],
    enabled: db !== null && enabled,
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      if (db === null) return false;
      const wrote = await prefillOwnerIfEmpty(db, today, timezone, true);
      // The athlete query runs beside this one and can answer "no athlete"
      // before the row lands, so the read is repeated here and awaited: this
      // query does not settle until the written row is the one in the cache.
      // Invalidating from an effect afterwards left one render in which the
      // write had settled and the cache still said there was no athlete, and
      // that is exactly the render a setup form seeds its fields from.
      if (wrote) {
        await client.refetchQueries({ queryKey: queryKeys.athlete() }, { cancelRefetch: true });
      }
      return wrote;
    },
  });

  if (!enabled || db === null) return { settled: true };
  return { settled: query.isSuccess || query.isError };
}
