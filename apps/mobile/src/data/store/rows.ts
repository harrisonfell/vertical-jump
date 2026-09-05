/**
 * Row plumbing shared by every repository: id generation, JSON columns, and
 * the 0/1 to boolean conversions. Nothing here knows about a table.
 */

let lastTime = 0;
let counter = 0;

/**
 * A sortable, collision-free id without a native crypto dependency, so the
 * same code runs on device, in the browser, during static rendering, and in
 * node tests.
 *
 * Deliberately not random: the app is one process per device, so a clock
 * reading plus a per-millisecond sequence is already unique, and a monotone id
 * sorts in insertion order. A clock that steps backwards keeps the last time
 * and keeps counting, so ids never repeat or go out of order. Duplicate work
 * is caught by idempotency keys, not by ids.
 */
export function newId(prefix: string): string {
  const now = Date.now();
  if (now > lastTime) {
    lastTime = now;
    counter = 0;
  } else {
    counter += 1;
  }
  const time = lastTime.toString(36).padStart(9, '0');
  const seq = counter.toString(36).padStart(6, '0');
  return `${prefix}_${time}${seq}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Serialise a JSON column. Undefined and null both store as NULL. */
export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/** Serialise a JSON column that must not be null. */
export function toJsonRequired(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Parse a JSON column. Corrupt text reads as null rather than crashing a screen. */
export function fromJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined || value === '') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function fromJsonArray<T>(value: string | null | undefined): readonly T[] {
  const parsed = fromJson(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function fromJsonRecord<T>(value: string | null | undefined): Readonly<Record<string, T>> {
  const parsed = fromJson(value);
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, T>;
  }
  return {};
}

export function bool(value: number | null | undefined): boolean {
  return value === 1;
}

export function boolOrNull(value: number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === 1;
}

export function intBool(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

export function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function str(value: string | null | undefined): string | null {
  return value === undefined ? null : value;
}

/** Narrow a text column to a known union, falling back when the value is unknown. */
export function oneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function oneOfOrNull<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}
