/** The application shell: providers, first-run routing, and the two chrome lines. */

export { AppThemeProvider, readSchemeParam, useThemeOverride, THEME_OVERRIDE_KEY } from './theme';
export { BootGate, BootSkeleton, BOOT_ERROR_COPY } from './boot';
export { ErrorBoundary, ERROR_BOUNDARY_COPY, type ErrorBoundaryProps } from './errorBoundary';
export { AppGateRoute, useAppGate, type AppGate } from './gate';
export {
  decideGate,
  gateRedirect,
  profileComplete,
  readClearance,
  stepOneComplete,
  type ClearanceReading,
  type GateAthlete,
  type GateInput,
  type GateState,
} from './gateDecision';
export {
  ownerMode,
  prefillOwnerIfEmpty,
  useOwnerPrefill,
  type OwnerPrefillState,
} from './ownerPrefill';
export { AppHeader, type AppHeaderProps } from './header';
export {
  fallbackFor,
  isTabRoute,
  splitHeaderTitle,
  type SplitTitle,
} from './headerTitle';
export { AppChrome, AppProviders, useAppFonts } from './providers';
export { useRestTimerPersistence } from './restTimerPersistence';
export { SyncLine } from './syncLine';
export {
  STALE_AFTER_DAYS,
  changeCount,
  formatClock,
  serverConfigured,
  serverUrl,
  syncLineText,
  waitingDays,
  type SyncLineInput,
} from './syncLineText';
export { ROUTES, href, routeHref, type RouteName } from './routes';
