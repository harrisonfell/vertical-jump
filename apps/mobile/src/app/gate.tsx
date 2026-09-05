import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAthlete, useCurrentProgram, useDbState } from '@/data';
import { decideGate, gateRedirect, type GateAthlete, type GateState } from './gateDecision';
import { useOwnerPrefill } from './ownerPrefill';
import { href } from './routes';
import { BootSkeleton } from './boot';

/**
 * First-run routing. The tabs mount behind this, and it only ever sends the
 * athlete somewhere once the database is open and both queries have answered:
 * "no program" and "not read yet" are the same shape, and only one of them is
 * a reason to leave.
 */

export interface AppGate {
  readonly state: GateState;
  /** True when the tabs may render. */
  readonly ready: boolean;
}

export function useAppGate(): AppGate {
  const { status } = useDbState();
  const prefill = useOwnerPrefill();
  const athlete = useAthlete();
  const program = useCurrentProgram();

  const gateAthlete: GateAthlete | null =
    athlete.data == null
      ? null
      : {
          clearance: athlete.data.clearance,
          sport: athlete.data.sport,
          daysPerWeek: athlete.data.daysPerWeek,
          weekdays: athlete.data.weekdays,
          goalHeightMm: athlete.data.goalHeightMm,
          targetDate: athlete.data.targetDate,
        };

  const state = decideGate({
    dbStatus: status,
    athleteLoaded: athlete.isSuccess || athlete.isError,
    programLoaded: program.isSuccess || program.isError,
    athlete: gateAthlete,
    hasProgram: program.data != null,
    prefillSettled: prefill.settled,
  });

  return { state, ready: state === 'ready' };
}

/** Wraps the tab tree: skeleton, redirect, or the tabs themselves. */
export function AppGateRoute({ children }: { readonly children: ReactNode }) {
  const { state } = useAppGate();

  if (state === 'loading' || state === 'error') return <BootSkeleton />;

  const target = gateRedirect(state);
  if (target !== null) return <Redirect href={href(target)} />;

  return <>{children}</>;
}

export {
  decideGate,
  gateRedirect,
  profileComplete,
  readClearance,
  stepOneComplete,
  type GateAthlete,
  type GateInput,
  type GateState,
} from './gateDecision';
