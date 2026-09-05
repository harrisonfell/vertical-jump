import type { Href } from 'expo-router';

/**
 * Every route the shell navigates to, in one place.
 *
 * expo-router's typed routes are generated from the files that exist right
 * now, and the setup, clearance and settings screens land after this shell.
 * `href` is the single narrowing point: when those files exist the generated
 * union covers these strings and nothing here has to change.
 */
export const ROUTES = {
  today: '/',
  plan: '/plan',
  progress: '/progress',
  setupGate: '/setup/gate',
  setupOne: '/setup/one',
  setupBuild: '/setup/build',
  clearance: '/clearance',
  settings: '/settings',
} as const;

export type RouteName = keyof typeof ROUTES;

/** One cast, named, so no screen writes its own. */
export function href(path: string): Href {
  return path as unknown as Href;
}

export function routeHref(name: RouteName): Href {
  return href(ROUTES[name]);
}
