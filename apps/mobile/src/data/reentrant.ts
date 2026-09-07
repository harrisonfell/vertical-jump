/**
 * Re-entrant transactions, for drivers whose own transaction is a bare BEGIN.
 *
 * SQLite has no nested BEGIN. expo-sqlite's `withTransactionAsync` issues one,
 * so a transaction opened inside another transaction is refused, and the inner
 * body's own error handling then rolls the *outer* transaction back. That is
 * not a theoretical hazard: a revision opens a transaction per week and calls
 * `createSession`, which opens one per session, so every revision on a device
 * would fail on its first session while the tests, which flattened nesting,
 * stayed green.
 *
 * The fix is the one SQLite offers: the outermost caller gets the driver's real
 * transaction, and every caller inside it gets a SAVEPOINT. RELEASE on success
 * pops it into the enclosing transaction; ROLLBACK TO on failure undoes only
 * the inner work and leaves the outer transaction open and usable. An error
 * that nobody catches still reaches the outermost body, which rolls the whole
 * thing back, so the guarantee callers already rely on is unchanged.
 *
 * Nothing here touches SQLite directly, which is the point: the two platform
 * executors hand it their own two primitives and the logic is unit-testable
 * without a device.
 */

export interface TransactionHost {
  /** The driver's own outermost transaction: BEGIN, then COMMIT or ROLLBACK. */
  readonly outer: (fn: () => Promise<void>) => Promise<void>;
  /** One statement, for the savepoints the inner transactions stand on. */
  readonly exec: (sql: string) => Promise<void>;
}

/** The savepoint an inner transaction at this depth stands on. */
export function savepointName(depth: number): string {
  return `vert_sp_${depth}`;
}

/**
 * A `withTransactionAsync` that may be called from inside itself.
 *
 * The depth counter is per executor, and every executor holds exactly one
 * connection, which is what makes a plain counter enough: statements on one
 * connection are serialised by the driver, so depth can only change between
 * awaits of this very function.
 */
export function reentrantTransaction(
  host: TransactionHost,
): (fn: () => Promise<void>) => Promise<void> {
  let depth = 0;

  const nested = async (fn: () => Promise<void>): Promise<void> => {
    depth += 1;
    const name = savepointName(depth);
    try {
      await host.exec(`SAVEPOINT ${name};`);
      try {
        await fn();
      } catch (error) {
        // ROLLBACK TO undoes the inner work but leaves the savepoint on the
        // stack, so it is released separately or it would shadow the next one.
        await host.exec(`ROLLBACK TO ${name};`);
        await host.exec(`RELEASE ${name};`);
        throw error;
      }
      await host.exec(`RELEASE ${name};`);
    } finally {
      depth -= 1;
    }
  };

  return (fn: () => Promise<void>): Promise<void> => {
    if (depth > 0) return nested(fn);
    return host.outer(async () => {
      depth = 1;
      try {
        await fn();
      } finally {
        // Whatever happened, the driver's transaction is over when this
        // returns, so the next call must open a real one again.
        depth = 0;
      }
    });
  };
}
