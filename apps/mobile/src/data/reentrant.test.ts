import { describe, expect, it } from 'vitest';
import { reentrantTransaction, savepointName, type TransactionHost } from './reentrant';

/**
 * The nesting logic, against a host that only records what it was asked to do.
 *
 * The bug this covers is the one a device would have hit on every revision:
 * `withTransactionAsync` inside `withTransactionAsync` issuing a second BEGIN,
 * which SQLite refuses, after which the inner body's own ROLLBACK unwinds the
 * outer transaction. Nothing here needs expo-sqlite; the executor hands this
 * function its two primitives and this test hands it two fakes.
 */

interface Recorder {
  readonly host: TransactionHost;
  readonly log: string[];
}

/** A host that behaves like a driver with one real transaction and savepoints. */
function recorder(): Recorder {
  const log: string[] = [];
  let open = false;
  const host: TransactionHost = {
    outer: async (fn) => {
      // The real failure mode, reproduced: a second BEGIN is an error.
      if (open) throw new Error('cannot start a transaction within a transaction');
      open = true;
      log.push('BEGIN');
      try {
        await fn();
      } catch (error) {
        log.push('ROLLBACK');
        open = false;
        throw error;
      }
      log.push('COMMIT');
      open = false;
    },
    exec: (sql) => {
      log.push(sql.replace(/;$/, ''));
      return Promise.resolve();
    },
  };
  return { host, log };
}

describe('reentrantTransaction', () => {
  it('opens one real transaction and a savepoint for the call inside it', async () => {
    const { host, log } = recorder();
    const transaction = reentrantTransaction(host);

    await transaction(async () => {
      log.push('outer work');
      await transaction(async () => {
        log.push('inner work');
      });
      log.push('more outer work');
    });

    expect(log).toEqual([
      'BEGIN',
      'outer work',
      'SAVEPOINT vert_sp_2',
      'inner work',
      'RELEASE vert_sp_2',
      'more outer work',
      'COMMIT',
    ]);
  });

  it('names a savepoint per level, so three deep never shadows two', async () => {
    const { host, log } = recorder();
    const transaction = reentrantTransaction(host);

    await transaction(() =>
      transaction(() =>
        transaction(() => {
          log.push('deepest');
          return Promise.resolve();
        }),
      ),
    );

    expect(log).toEqual([
      'BEGIN',
      `SAVEPOINT ${savepointName(2)}`,
      `SAVEPOINT ${savepointName(3)}`,
      'deepest',
      `RELEASE ${savepointName(3)}`,
      `RELEASE ${savepointName(2)}`,
      'COMMIT',
    ]);
  });

  it('rolls an inner failure back to its savepoint and leaves the outer open', async () => {
    const { host, log } = recorder();
    const transaction = reentrantTransaction(host);

    await transaction(async () => {
      try {
        await transaction(() => Promise.reject(new Error('the session did not save')));
      } catch {
        log.push('outer handled it');
      }
      log.push('outer keeps writing');
    });

    expect(log).toEqual([
      'BEGIN',
      'SAVEPOINT vert_sp_2',
      'ROLLBACK TO vert_sp_2',
      'RELEASE vert_sp_2',
      'outer handled it',
      'outer keeps writing',
      'COMMIT',
    ]);
  });

  it('still rolls the whole thing back when the inner failure is not caught', async () => {
    const { host, log } = recorder();
    const transaction = reentrantTransaction(host);

    await expect(
      transaction(() => transaction(() => Promise.reject(new Error('nope')))),
    ).rejects.toThrow('nope');

    expect(log).toEqual([
      'BEGIN',
      'SAVEPOINT vert_sp_2',
      'ROLLBACK TO vert_sp_2',
      'RELEASE vert_sp_2',
      'ROLLBACK',
    ]);
  });

  it('opens a real transaction again after one failed', async () => {
    const { host, log } = recorder();
    const transaction = reentrantTransaction(host);

    await expect(transaction(() => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    await transaction(() => {
      log.push('second');
      return Promise.resolve();
    });

    // A depth left at 1 by the failure would have made this a savepoint on a
    // transaction that is no longer open.
    expect(log).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'second', 'COMMIT']);
  });
});
