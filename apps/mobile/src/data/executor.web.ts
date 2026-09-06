import { Asset } from 'expo-asset';
import type { Database, SqlJsStatic } from 'sql.js';
import { DEFAULT_DATABASE_NAME } from './dbName';
import { createSqlJsExecutor } from './executor.sqljs';
import type { OpenExecutorOptions, SqlExecutor } from './executor';

/**
 * The web executor: sql.js, persisted to IndexedDB.
 *
 * expo-sqlite ships a web backend in SDK 57, and it was ruled out twice over.
 * It talks to its worker through `SharedArrayBuffer` + `Atomics.wait`, so it
 * only runs on a cross-origin-isolated page (COOP same-origin, COEP
 * require-corp) - headers a static Expo export cannot set and which would break
 * every third-party embed on the same origin. Worse, it resolves its worker as
 * `new Worker(new URL('./worker', window.location.href))`, which is relative to
 * the *page*, so it 404s on every nested route (/progress, /settings/import).
 *
 * sql.js has neither problem: the wasm payload is a Metro asset served from an
 * absolute /assets URL (see metro.config.js), and the database lives in memory,
 * exported to IndexedDB 250 ms after the last write and again whenever the tab
 * is hidden. One athlete, one small database: a full export is a few hundred
 * kilobytes and costs nothing at this size.
 */

const IDB_NAME = 'vert-sqlite';
const IDB_STORE = 'databases';
const IDB_VERSION = 1;
const FLUSH_DEBOUNCE_MS = 250;

// Metro serves the payload as an asset; on web the module is already the URL.
const wasmModule: string | number = require('sql.js/dist/sql-wasm-browser.wasm');

type InitSqlJs = (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;

let enginePromise: Promise<SqlJsStatic> | null = null;

function loadEngine(): Promise<SqlJsStatic> {
  if (enginePromise === null) {
    const initSqlJs: InitSqlJs = require('sql.js/dist/sql-wasm-browser.js');
    const uri = Asset.fromModule(wasmModule).uri;
    enginePromise = initSqlJs({ locateFile: () => uri });
  }
  return enginePromise;
}

export async function openExecutor(options?: OpenExecutorOptions): Promise<SqlExecutor> {
  const key = options?.databaseName ?? DEFAULT_DATABASE_NAME;
  const SQL = await loadEngine();
  const saved = await readBytes(key);
  const db: Database = saved === null ? new SQL.Database() : new SQL.Database(saved);

  db.run('PRAGMA foreign_keys = ON;');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> = Promise.resolve();
  let executor: SqlExecutor | null = null;

  // Through the executor rather than `db.export()` directly: the executor
  // serialises against its own transactions and may have swapped the handle
  // for a snapshot pulled from the server, and both are its to know.
  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const current = executor;
    if (current === null) return Promise.resolve();
    const persist = async (): Promise<void> => writeBytes(key, await current.serializeAsync());
    flushing = flushing.then(persist, persist);
    return flushing;
  };

  const scheduleFlush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_DEBOUNCE_MS);
  };

  const onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') void flush();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onVisibilityChange);
  }

  executor = createSqlJsExecutor(db, {
    reopen: (bytes) => new SQL.Database(bytes),
    onWrite: scheduleFlush,
    onClose: async () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onVisibilityChange);
      }
      await flush();
    },
  });
  return executor;
}

/* ------------------------------------------------------------- IndexedDB */

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    // A private window with storage blocked is a working, in-memory session.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readBytes(key: string): Promise<Uint8Array | null> {
  const idb = await openIdb();
  if (idb === null) return null;
  return new Promise((resolve) => {
    const request = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    request.onsuccess = () => {
      const value: unknown = request.result;
      if (value instanceof Uint8Array) resolve(value);
      else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
      else resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

async function writeBytes(key: string, bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  if (idb === null) return;
  await new Promise<void>((resolve) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}
