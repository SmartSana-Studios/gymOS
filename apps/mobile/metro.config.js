const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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

module.exports = config;
