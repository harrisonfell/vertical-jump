/**
 * One origin, two halves.
 *
 * `/api/*` is this project's route handlers. Everything else is the Expo web
 * bundle, exported into `public/app` by `scripts/build-web.mjs` and served from
 * there by these rewrites. Keeping both on one domain is what makes the owner's
 * session cookie first party and lets the paired phone's Bearer reach the same
 * host it was paired against.
 *
 * The rewrites are `afterFiles`, so a real file always wins and only a path
 * with nothing behind it is rewritten. The export names its bundles from the
 * root (`/_expo/...`, `/assets/...`, `/favicon.ico`), so those are pointed back
 * into `/app` rather than moved, which keeps the exported html untouched.
 */

import { fileURLToPath } from 'node:url';

/** Expo writes one html file per route; these are the routes the app has. */
const staticRoutes = [
  ['/plan', '/app/plan.html'],
  ['/progress', '/app/progress.html'],
  ['/clearance', '/app/clearance.html'],
  ['/pair', '/app/pair.html'],
  ['/login', '/app/login.html'],
  ['/privacy', '/app/privacy.html'],
  ['/setup/gate', '/app/setup/gate.html'],
  ['/setup/one', '/app/setup/one.html'],
  ['/setup/two', '/app/setup/two.html'],
  ['/setup/three', '/app/setup/three.html'],
  ['/setup/build', '/app/setup/build.html'],
  ['/settings', '/app/settings/index.html'],
  ['/settings/whoop', '/app/settings/whoop.html'],
  ['/settings/import', '/app/settings/import.html'],
];

/**
 * `+not-found` and `[id]` are literal characters in the exported file names.
 * Percent encoding them keeps path-to-regexp from reading `+` as a repeat
 * modifier in a rewrite destination; Next decodes the pathname again before it
 * looks for the file.
 */
const NOT_FOUND = '/app/%2Bnot-found.html';
const SESSION = '/app/session/%5Bid%5D.html';

/**
 * Everything that is neither an API path nor a hashed build artifact.
 *
 * Header rules see the path after the rewrites, so this excludes the `/app/...`
 * form of the bundle directories rather than the form the browser asked for.
 */
const HTML_PATHS = '/:path((?!api/|_expo/|assets/|app/_expo/|app/assets/).*)';

const IMMUTABLE = [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }];
const REVALIDATE = [{ key: 'cache-control', value: 'public, max-age=0, must-revalidate' }];

/** The workspace root, so the build traces files from a monorepo it is inside. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel builds this project with the root directory set to apps/server and
  // the rest of the repo present. Naming the root stops Next guessing it from
  // whichever lockfile it finds first, which on a developer machine can be one
  // outside the repo entirely.
  outputFileTracingRoot: repoRoot,
  // The server is route handlers plus one health page; nothing is prerendered
  // from a database, so the build never needs DATABASE_URL.
  serverExternalPackages: ['postgres'],

  async rewrites() {
    return {
      beforeFiles: [
        // Today. This one has to come before the filesystem, because Next's own
        // placeholder page holds `/` and would otherwise win it.
        { source: '/', destination: '/app/index.html' },
      ],
      afterFiles: [
        ...staticRoutes.map(([source, destination]) => ({ source, destination })),
        // A session id is a route parameter on the phone; the exported html for
        // the dynamic segment reads the real id back off `location`, so every
        // id serves the one file expo-router wrote.
        { source: '/session/:id', destination: SESSION },
        // The bundle, the fonts, and the favicon, named from the root by the
        // export and served out of `public/app`.
        { source: '/_expo/:path*', destination: '/app/_expo/:path*' },
        { source: '/assets/:path*', destination: '/app/assets/:path*' },
        { source: '/favicon.ico', destination: '/app/favicon.ico' },
      ],
      fallback: [
        // Anything left. `/api/` is excluded by the negative lookahead rather
        // than by ordering, so an unknown API path still answers as an API path
        // instead of handing back an html page a fetch would try to parse.
        { source: '/:path((?!api/).*)', destination: NOT_FOUND },
      ],
    };
  },

  async headers() {
    return [
      // Every file under `_expo/static` and `assets` carries a content hash in
      // its name, so it can be cached for a year and a new build invalidates
      // itself. Both the rewritten path and the path on disk, so a direct hit
      // on `/app/...` is cached the same way.
      { source: '/_expo/static/:path*', headers: IMMUTABLE },
      { source: '/assets/:path*', headers: IMMUTABLE },
      { source: '/app/_expo/static/:path*', headers: IMMUTABLE },
      { source: '/app/assets/:path*', headers: IMMUTABLE },
      // The html names those hashed files, so it must never be the stale half
      // of the pair. Revalidate every load; the payload is small.
      { source: HTML_PATHS, headers: REVALIDATE },
      // One owner, one app: nothing here belongs in a frame or a search index.
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'x-frame-options', value: 'DENY' },
          { key: 'referrer-policy', value: 'same-origin' },
          { key: 'x-robots-tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
