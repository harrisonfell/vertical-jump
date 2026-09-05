import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys, readinessStore } from '@/data';
import { useDbOrNull } from '@/data/db';
import type { LocalDate, SessionAnswer } from '@/data/types';

/**
 * The finger answer for one day, not for today
 * (house rule `house.sc.finger_pain_ceiling`).
 *
 * `useFingerPain` in the data layer reads the answer for today, which is what
 * the runner needs. A session read afterwards needs the answer for the day it
 * was performed on, so this asks for that date. It sits under the same
 * `['readiness', 'answer', kind, date]` key, so changing the answer on Today
 * invalidates both.
 */
export function useFingerPainOn(date: LocalDate | null): UseQueryResult<SessionAnswer | null> {
  const db = useDbOrNull();
  return useQuery({
    queryKey: queryKeys.sessionAnswer('finger_pain', date ?? ''),
    enabled: db !== null && date !== null,
    queryFn: async () =>
      db === null || date === null
        ? null
        : readinessStore.getSessionAnswer(db, date, 'finger_pain'),
  });
}
