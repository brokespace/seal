// Seal's identity, in one place. Build scripts read it from here instead of carrying their own
// copy; the constants compiled into the app (src/shared/app-identity.ts and the files
// seal-rebrand-check.mjs lists) are checked against it. See docs/upstream-sync.md.
const productName = 'Seal'
const appId = 'com.brokespace.seal'
const repository = { owner: 'brokespace', name: 'seal' }

module.exports = {
  productName,
  /** The name upstream ships under; user-visible copy must not carry it outside attribution. */
  upstreamProductName: 'Orca',
  appId,
  /** The command Seal installs on PATH. The bundled launchers keep upstream's `orca` name. */
  cliCommand: 'seal',
  repository,
  homepage: `https://github.com/${repository.owner}/${repository.name}`,
  author: repository.owner,
  description: 'Seal: a fork of Orca, the next-gen IDE for parallel agentic development',
  linux: {
    // Not `orca-ide`: an installed Orca owns that package, its icons, mime and desktop files.
    executableName: 'seal',
    packageName: 'seal',
    // Electron reports WM_CLASS as the lowercased app name; docks group on an exact match.
    startupWMClass: 'seal',
    maintainer: repository.owner
  },
  windows: {
    executableName: productName,
    cliShim: { from: 'resources/win32/bin/seal.cmd', to: 'bin/seal.cmd' }
  },
  macos: {
    computerUseHelperName: `${productName} Computer Use`,
    computerUseBundleId: `${appId}.computer-use`,
    terminalHostName: `${productName} Agents`
  },
  signing: {
    // Seal has no Apple Developer team yet. A release build checks its helpers against this id
    // once it is set; until then nothing is pinned to upstream's team.
    macTeamId: process.env.SEAL_MAC_TEAM_ID || null
  },
  releases: {
    // Never upstream's repositories: Seal must not publish to or update from Orca's releases.
    owner: repository.owner,
    repo: repository.name,
    /** Upstream's dev-channel repo names (`orca-hourly`) map to Seal's (`seal-hourly`). */
    devChannelRepo: (upstreamRepo) => `${repository.name}-${upstreamRepo.replace(/^orca-/, '')}`
  },
  icons: {
    source: 'resources/icon-source/seal-app-icon.svg',
    app: ['resources/build/icon.icns', 'resources/build/icon.ico', 'resources/build/icon.png'],
    mobile: 'mobile/assets/icon.png'
  }
}
