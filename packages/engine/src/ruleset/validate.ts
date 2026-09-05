/**
 * The ruleset loader's primitive validators.
 *
 * Split out of `index.ts` so both files stay under the 500-line limit.
 * Validation is total: a malformed file throws at load, never at prescription
 * time, and every message names the path that failed.
 */
import type { Level } from '../types/core.js';
import type { Range } from '../types/ruleset.js';

export const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

/** Thrown when the ruleset file does not match the contract. */
export class RulesetValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`ruleset ${path}: ${detail}`);
    this.name = 'RulesetValidationError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function obj(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new RulesetValidationError(path, 'expected an object');
  return value;
}

export function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RulesetValidationError(path, 'expected a finite number');
  }
  return value;
}

export function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesetValidationError(path, 'expected a non-empty string');
  }
  return value;
}

export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new RulesetValidationError(path, 'expected a boolean');
  return value;
}

export function numArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new RulesetValidationError(path, 'expected an array');
  return value.map((item, index) => num(item, `${path}[${index}]`));
}

export function range(value: unknown, path: string): Range {
  const record = obj(value, path);
  const bottom = num(record['bottom'], `${path}.bottom`);
  const top = num(record['top'], `${path}.top`);
  if (top < bottom) throw new RulesetValidationError(path, 'top is below bottom');
  return { bottom, top };
}

export function byLevel<T>(
  value: unknown,
  path: string,
  read: (v: unknown, p: string) => T,
): Record<Level, T> {
  const record = obj(value, path);
  const out = {} as Record<Level, T>;
  for (const level of LEVELS) out[level] = read(record[level], `${path}.${level}`);
  return out;
}

export function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const text = str(value, path);
  const match = allowed.find((candidate) => candidate === text);
  if (match === undefined) {
    throw new RulesetValidationError(path, `expected one of ${allowed.join(', ')}`);
  }
  return match;
}
