/**
 * Migration 6: the best recent set per lift.
 *
 * The owner types one set they know is close to their limit (reps, load and
 * effort) instead of guessing a 1RM, and R73's Epley reads it. It is one
 * document per athlete rather than a table because it is an answer, not a
 * stream: a lift has exactly one best recent set on file and typing a newer
 * one replaces it. The logged sets that make an estimate already live in
 * `set_log`, and nothing here duplicates them.
 *
 * Additive and nullable: an athlete who typed none has NULL here and every
 * working max resolves exactly as it did before.
 */
export const MIGRATION_0006 = `
ALTER TABLE athlete ADD COLUMN best_sets_json TEXT;
`;
