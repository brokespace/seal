const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')

const config = getDefaultConfig(projectRoot)

// Watch repo root: mobile source-control uses desktop’s pure prompt builders, outside Metro’s default mobile-only scope.
config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), sharedRoot]))

// RN 0.88 registers assets through the bare `react-native/asset-registry` import, which Metro resolves from
// the asset's own folder. Shared assets live outside mobile/, so fall back to mobile's react-native.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native': path.join(projectRoot, 'node_modules', 'react-native')
}

// Seal: rebrand modules and catalogs before Expo's transform worker sees them.
process.env.SEAL_METRO_UPSTREAM_TRANSFORM_WORKER = config.transformerPath
config.transformerPath =
  require.resolve('../config/seal/brand-copy/seal-brand-metro-transform-worker.cjs')

module.exports = config
