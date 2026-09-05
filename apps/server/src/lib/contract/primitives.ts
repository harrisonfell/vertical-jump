/**
 * The shapes every other part of the wire contract is built from: the two date
 * spellings, arbitrary JSON, Whoop's score state, and the one error body.
 *
 * The contract is split across this folder so no file passes its reading
 * length; `../api-contract.ts` re-exports the whole of it, and that barrel is
 * still the only name anything imports.
 */

import { z } from 'zod';


const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** ISO 8601 instant, always with an offset or Z. */
export const isoTimestamp = z.string().regex(ISO, 'expected an ISO 8601 timestamp');

/** "YYYY-MM-DD" derived from a record's own timezone offset, never from UTC. */
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

/** Whoop marks every object; a score is absent unless the state is SCORED. */
export const scoreState = z.enum(['SCORED', 'PENDING_SCORE', 'UNSCORABLE']);
export type ScoreState = z.infer<typeof scoreState>;

/** The two failures that earn their own copy, plus the two transport ones. */
export const whoopErrorKind = z.enum(['api_down', 'rate_limited', 'needs_reauth', 'network']);
export type WhoopErrorKind = z.infer<typeof whoopErrorKind>;

/** Every error body the server returns is this shape. */
export const apiError = z.object({
  error: z.string(),
  message: z.string(),
  retryAfterS: z.number().int().nonnegative().nullable().default(null),
});
export type ApiError = z.infer<typeof apiError>;

