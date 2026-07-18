const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pnpm regenerates dangling junctions under node_modules/.ignored on this
// Windows setup (Developer Mode/symlink privileges are incomplete), and
// Metro's FallbackWatcher throws EACCES trying to lstat them. Excluding
// the directory from Metro's crawl avoids the crash entirely.
config.resolver.blockList = [/node_modules[\\/]\.ignored([\\/].*)?$/];

module.exports = config;
