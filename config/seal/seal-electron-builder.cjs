// Lays Seal's identity (seal-branding.cjs) over upstream's electron-builder config, so that file
// keeps upstream's ids and names and its one hook is the last line. The copy inside it (usage
// descriptions, helper app names) is rebranded in place by apply-seal-brand-copy.mjs.
const branding = require('./seal-branding.cjs')

/** @param {import('electron-builder').Configuration} config */
function applySealBranding(config) {
  config.appId = branding.appId
  config.productName = branding.productName
  config.protocols = config.protocols.map((protocol) => ({
    ...protocol,
    name: branding.productName
  }))

  config.win.executableName = branding.windows.executableName
  config.win.extraResources = [...config.win.extraResources, branding.windows.cliShim]

  // The helper is built under Seal's name (build-computer-macos.mjs) and ships under it.
  const upstreamHelperApp = `${branding.upstreamProductName} Computer Use.app`
  const helperApp = `${branding.macos.computerUseHelperName}.app`
  config.mac.extraResources = config.mac.extraResources.map((resource) =>
    typeof resource === 'object' && resource.from?.endsWith(upstreamHelperApp)
      ? { ...resource, from: resource.from.replace(upstreamHelperApp, helperApp), to: helperApp }
      : resource
  )

  config.linux.executableName = branding.linux.executableName
  config.linux.maintainer = branding.linux.maintainer
  config.linux.desktop.entry.StartupWMClass = branding.linux.startupWMClass
  config.deb.packageName = branding.linux.packageName
  config.rpm.packageName = branding.linux.packageName

  const devChannelRepo = config.publish.repo.startsWith('orca-') ? config.publish.repo : null
  config.publish = {
    ...config.publish,
    owner: branding.releases.owner,
    repo: devChannelRepo ? branding.releases.devChannelRepo(devChannelRepo) : branding.releases.repo
  }
  return config
}

module.exports = { applySealBranding }
