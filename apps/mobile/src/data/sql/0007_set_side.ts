/**
 * Migration 7: which side a unilateral set ran on.
 *
 * A single-leg row is prescribed once and performed twice, and the two legs do
 * not always report the same effort: single-leg RDLs at 30, 35 and 40 lb where
 * the right leg never passes RPE 6 and the left reaches 8 is one row of three
 * sets carrying two different answers. Without a side there is nowhere to put
 * the second answer, so the gap the athlete felt is lost on the way to the
 * ledger.
 *
 * Additive and nullable: NULL is a set logged for both sides at once, which is
 * every set already on file and still what a plain tap writes.
 *
 * The one-row-per-set index has to widen with it, or the second leg is refused
 * as a duplicate. It is rebuilt over `COALESCE(side, 'both')` rather than over
 * `side`, because SQLite counts NULLs as distinct in a unique index and a bare
 * `side` column would quietly let two both-sides logs share a set number.
 */
export const MIGRATION_0007 = `
ALTER TABLE set_log ADD COLUMN side TEXT;

DROP INDEX IF EXISTS set_log_by_set;
CREATE UNIQUE INDEX IF NOT EXISTS set_log_by_set
  ON set_log (session_exercise_id, set_number, COALESCE(side, 'both'));
`;
