const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Story 14.1: swaps the plain expo/metro-config base for Sentry's wrapper
// (source-map/debug-id injection for error symbolication) -- both
// pre-existing customizations below survive the swap untouched.
const config = getSentryExpoConfig(__dirname);

// expo-sqlite's web implementation (wa-sqlite) ships a .wasm binary that
// Metro doesn't recognize as a bundleable asset by default -- without this,
// `expo start --web` fails to resolve it entirely ("Unable to resolve
// module ./wa-sqlite.wasm"). Web is only used for taking Play Store
// screenshots; the native apps never hit this path.
config.resolver.assetExts.push('wasm');

// pnpm regenerates dangling junctions under node_modules/.ignored on this
// Windows setup (Developer Mode/symlink privileges are incomplete), and
// Metro's FallbackWatcher throws EACCES trying to lstat them. Excluding
// the directory from Metro's crawl avoids the crash entirely.
config.resolver.blockList = [/node_modules[\\/]\.ignored([\\/].*)?$/];

// Local Epic 19 QA in Expo Go only (scripts/epic19-qa/start-mobile.sh sets QA_EXPO_GO=1): Expo Go on
// Android cannot import expo-notifications, so swap in a no-op stub. Inert in every real build.
if (process.env.QA_EXPO_GO === '1') {
  const path = require('path');
  const stub = path.resolve(__dirname, '../../scripts/epic19-qa/stubs/expo-notifications.js');
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'expo-notifications') return { type: 'sourceFile', filePath: stub };
    return (upstream ?? context.resolveRequest)(context, moduleName, platform);
  };
}

module.exports = config;
