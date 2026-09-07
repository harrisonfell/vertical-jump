import { useEffect, useRef } from 'react';
import { useRevise, useRevisionTarget } from '../plan/useRevise';

/**
 * The automatic revision, fired once per Today mount.
 *
 * The condition is arithmetic over rows Today already loads: a week newer than
 * the one the current projections came from has something logged in it, and
 * there is still an unstarted week to rebuild. When that is false, which is
 * almost always, this hook does nothing at all.
 *
 * It is silent both ways. A revision that succeeds shows up as the Plan's
 * weeks changing and a new line in the version history; one that the engine
 * refuses leaves every row exactly as it was and says nothing here, because
 * Today is the screen the athlete opens to train, not to be told about a
 * background job. The Settings action is where a refusal gets a sentence.
 */
export function useAutoRevise(): void {
  const target = useRevisionTarget();
  const revise = useRevise();
  const fired = useRef(false);

  const shouldRevise = target?.shouldRevise === true;
  const { mutate } = revise;

  useEffect(() => {
    if (!shouldRevise || fired.current) return;
    fired.current = true;
    mutate(undefined, {
      onError: () => {
        // Nothing was written, so there is nothing to undo and nothing to say.
      },
    });
  }, [shouldRevise, mutate]);
}
