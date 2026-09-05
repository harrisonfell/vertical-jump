/**
 * Every path in one place, and the credential each one accepts.
 */


/** Every path in one place, so the app and the tests never spell one wrong. */
export const API = {
  health: '/api/health',
  pairStart: '/api/pair/start',
  pairClaim: '/api/pair/claim',
  deviceMe: '/api/device/me',
  login: '/api/login',
  logout: '/api/logout',
  whoopStart: '/api/whoop/start',
  whoopStartToken: '/api/whoop/start-token',
  whoopCallback: '/api/whoop/callback',
  whoopStatus: '/api/whoop/status',
  whoopSync: '/api/whoop/sync',
  whoopDisconnect: '/api/whoop/disconnect',
  whoopRevoke: '/api/whoop/revoke',
  whoopData: '/api/whoop/data',
  whoopWebhook: '/api/whoop/webhook',
  mirrors: '/api/mirrors',
  syncPush: '/api/sync/push',
  syncPull: '/api/sync/pull',
  exportData: '/api/export',
} as const;

export type ApiPath = (typeof API)[keyof typeof API];

/** Which credential each path accepts. Bearer is the phone, session the web. */
export const AUTH: Readonly<Record<ApiPath, 'public' | 'session' | 'bearer' | 'either'>> = {
  '/api/health': 'public',
  '/api/pair/start': 'session',
  '/api/pair/claim': 'public',
  '/api/device/me': 'bearer',
  '/api/login': 'public',
  '/api/logout': 'public',
  '/api/whoop/start': 'either',
  '/api/whoop/start-token': 'bearer',
  '/api/whoop/callback': 'public',
  '/api/whoop/status': 'either',
  '/api/whoop/sync': 'either',
  '/api/whoop/disconnect': 'either',
  '/api/whoop/revoke': 'either',
  '/api/whoop/data': 'either',
  '/api/whoop/webhook': 'public',
  '/api/mirrors': 'either',
  '/api/sync/push': 'either',
  '/api/sync/pull': 'either',
  '/api/export': 'either',
};
