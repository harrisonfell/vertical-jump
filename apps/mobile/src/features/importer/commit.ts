/**
 * Turning the previewed rows into what the store writes.
 *
 * Grouping happens here rather than in the write: a jump test is a date plus a
 * mode plus its attempts, and an export is one flat row per rep, so the shape
 * has to be rebuilt. Imported tests are never canonical and never scheduled:
 * the canonical weekly test is the one the athlete typed under the protocol,
 * and letting an imported row claim that status would move the trend line.
 */
import type { Instrument, LocalDate } from '@/data';
import type { ImportJumpGroup, ImportVbtSet } from '@/data';
import { exerciseKey, type VelocitySetGroup } from './dedupe';
import type { ParsedJumpRow } from './normalize';

/** Which stream an imported row belongs to. RSI mode is its own stream. */
export function instrumentFor(mode: string): Instrument {
  return mode === 'rsi' ? 'ovr_jump_rsi' : 'ovr_jump_regular';
}

/** One group per date and mode, attempts renumbered from one. */
export function toJumpGroups(rows: readonly ParsedJumpRow[]): ImportJumpGroup[] {
  const groups = new Map<string, ParsedJumpRow[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = `${row.date}|${row.mode}`;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
      order.push(key);
    } else {
      bucket.push(row);
    }
  }

  return order.map((key) => {
    const bucket = [...(groups.get(key) ?? [])].sort((a, b) => a.attempt - b.attempt);
    const first = bucket[0];
    const mode = first?.mode ?? 'cmj';
    const bodyweight = bucket.find((row) => row.bodyweightKg !== null)?.bodyweightKg ?? null;

    return {
      localDate: (first?.date ?? '') as LocalDate,
      instrument: instrumentFor(mode),
      mode,
      bodyweightKg: bodyweight,
      attempts: bucket.map((row, index) => ({
        attemptIndex: index + 1,
        heightMm: Math.round(row.heightMm),
        gctMs: row.gctMs === null ? null : Math.round(row.gctMs),
        rsiCalc:
          row.gctMs === null || row.gctMs <= 0 ? null : row.heightMm / 1000 / (row.gctMs / 1000),
        rsiDevice: row.rsiDevice,
        flagged: false,
        entrySource: 'imported' as const,
      })),
    };
  });
}

/** One vbt_set row per grouped set, with its per-rep values. */
export function toVbtSets(groups: readonly VelocitySetGroup[]): ImportVbtSet[] {
  return groups.map((group) => ({
    localDate: group.date,
    exerciseId: exerciseKey(group.exercise).replace(/ /g, '_'),
    setNumber: group.set,
    loadKg: group.loadKg,
    repsCompleted: group.reps.length,
    meanVelocityBest: group.meanVelocityBest,
    meanVelocityLast: group.meanVelocityLast,
    velocityLossPct: group.velocityLossPct,
    reps: group.reps.map((rep, index) => ({
      repIndex: rep.rep > 0 ? rep.rep : index + 1,
      meanVelocity: rep.meanVelocity,
      peakVelocity: rep.peakVelocity,
      romMm: rep.romMm,
      powerW: rep.powerW,
    })),
  }));
}
