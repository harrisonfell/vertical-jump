import { create } from 'zustand';

/**
 * "Use my saved profile", in flight.
 *
 * Settings asks for it, both setup steps read it, and step 2's save clears it.
 * Nothing here is written to the database: the point of the action is that the
 * answers arrive in the form and stay there until the athlete saves them, so
 * the request is ephemeral by design and losing it costs one tap.
 */

export interface SetupPrefillState {
  /** True from the moment Settings asks until step 2 is saved. */
  readonly ownerRequested: boolean;
  requestOwnerPrefill(): void;
  clearOwnerPrefill(): void;
}

export const useSetupPrefill = create<SetupPrefillState>()((set) => ({
  ownerRequested: false,
  requestOwnerPrefill: () => set({ ownerRequested: true }),
  clearOwnerPrefill: () => set({ ownerRequested: false }),
}));
