// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// sql.js is the web SQLite engine (see src/data/executor.web.ts). Metro has to
// treat its .wasm payload as an asset so the exported site serves it verbatim.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// @vert/engine is pure ESM TypeScript compiled by nobody: it is consumed from
// source, and its own relative imports carry the ".js" specifier that Node's
// ESM resolver requires ("./calendar.js" for calendar.ts). Metro resolves
// extensions its own way and does not rewrite that, so a deep engine import
// fails at bundle time. Rewrite ".js" back to the TypeScript file, and only for
// requests that come out of packages/engine, so nothing in the app changes.
const ENGINE_SOURCE = path.join(__dirname, '..', '..', 'packages', 'engine');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromEngine =
    typeof context.originModulePath === 'string' &&
    context.originModulePath.startsWith(ENGINE_SOURCE);

  if (fromEngine && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

// Web exports (`npx expo export --output-dir dist-<name>`) write and delete
// large trees inside this folder while a dev server may be watching it. Metro's
// Windows watcher can crash on those transient paths, so every dist folder is
// excluded from the file map and the watcher.
const DIST_PATTERN = /[\\/]apps[\\/]mobile[\\/]dist[^\\/]*[\\/]/;
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existingBlockList)
  ? [...existingBlockList, DIST_PATTERN]
  : existingBlockList
    ? [existingBlockList, DIST_PATTERN]
    : [DIST_PATTERN];

module.exports = config;
