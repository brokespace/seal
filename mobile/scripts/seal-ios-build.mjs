#!/usr/bin/env node
// Builds Seal for your own iPhone without EAS or an Expo account (macOS + Xcode).
//
//   SEAL_APPLE_TEAM_ID=ABCDE12345 node scripts/seal-ios-build.mjs dev [--device <name|udid>]
//     Debug dev client on a USB/Wi-Fi-connected iPhone (sandbox APNs). Pair, then `pnpm start`.
//   SEAL_APPLE_TEAM_ID=ABCDE12345 node scripts/seal-ios-build.mjs adhoc [--install <udid>]
//     Release IPA signed for registered devices (production APNs) in build/ios-adhoc/.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const MOBILE_ROOT = path.resolve(import.meta.dirname, '..')
const WORKSPACE = path.join(MOBILE_ROOT, 'ios', 'Seal.xcworkspace')
const BUILD_DIR = path.join(MOBILE_ROOT, 'build')
const ARCHIVE = path.join(BUILD_DIR, 'Seal.xcarchive')
const EXPORT_DIR = path.join(BUILD_DIR, 'ios-adhoc')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args, env = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: MOBILE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
  if (result.status !== 0) {
    fail(`${command} exited with ${result.status ?? result.signal}`)
  }
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'adhoc') {
  fail('Usage: seal-ios-build.mjs <dev|adhoc> [--device <name|udid>] [--install <udid>]')
}
if (process.platform !== 'darwin') {
  fail('iOS builds need macOS with Xcode.')
}
const teamId = process.env.SEAL_APPLE_TEAM_ID
if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) {
  fail('Set SEAL_APPLE_TEAM_ID to your 10-character Apple Developer Team ID.')
}

if (mode === 'dev') {
  const device = flag('device')
  run(
    'npx',
    [
      'expo',
      'run:ios',
      '--configuration',
      'Debug',
      ...(device ? ['--device', device] : ['--device'])
    ],
    {
      ORCA_IOS_APS_ENVIRONMENT: 'development'
    }
  )
  process.exit(0)
}

const apsEnv = { ORCA_IOS_APS_ENVIRONMENT: 'production' }
run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], apsEnv)
run(
  'xcodebuild',
  [
    '-workspace',
    WORKSPACE,
    '-scheme',
    'Seal',
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    ARCHIVE,
    '-allowProvisioningUpdates',
    `DEVELOPMENT_TEAM=${teamId}`,
    'CODE_SIGN_STYLE=Automatic',
    'archive'
  ],
  apsEnv
)
mkdirSync(EXPORT_DIR, { recursive: true })
const exportOptions = path.join(BUILD_DIR, 'SealAdHocExportOptions.plist')
writeFileSync(
  exportOptions,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>release-testing</string>
  <key>teamID</key><string>${teamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
</dict>
</plist>
`
)
run('xcodebuild', [
  '-exportArchive',
  '-archivePath',
  ARCHIVE,
  '-exportOptionsPlist',
  exportOptions,
  '-exportPath',
  EXPORT_DIR,
  '-allowProvisioningUpdates'
])
const ipa = path.join(EXPORT_DIR, 'Seal.ipa')
console.log(`Ad-hoc IPA: ${ipa}`)
const installTarget = flag('install')
if (installTarget) {
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', installTarget, ipa])
}
