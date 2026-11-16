/** Which service manager keeps the server running, from what one probe of the host answered. */
import type { OwnSealServe } from './own-seal-serve-probe'
import type { SealServerKeeper, SealServiceManager, SealServiceWish } from './seal-service-policy'

export type SealServiceProbe = {
  platform: 'linux' | 'darwin' | 'other'
  /** The account the host names itself (`id -un`); null when it did not say. */
  user: string | null
  /** `systemctl --user show-environment` succeeded. */
  systemdUser: boolean
  launchctl: boolean
  /** macOS: launchd's `gui/<uid>` domain exists, which it does while the user is logged in at the screen. */
  guiSession: boolean
  /** `pm2` is on the launching shell's PATH. */
  pm2: boolean
  /** The manager the host's marker names: the truth for every desktop that connects. */
  installed: SealServiceManager | null
  /** The installed manager still holds the service and the launcher is in place. */
  registered: boolean
  /** A server the user keeps running with `seal serve service install`. */
  ownServe: OwnSealServe | null
  /** systemd: null when logind did not answer. */
  linger: boolean | null
  /** The user's own `pm2 startup`; null when it cannot be told. */
  pm2StartsAtBoot: boolean | null
}

// launchd is not here: it is used only when preferred.
const AUTOMATIC_MANAGERS: readonly SealServiceManager[] = ['pm2', 'systemd-user']

function hasLaunchd(probe: SealServiceProbe): boolean {
  return probe.platform === 'darwin' && probe.launchctl
}

export function sealServiceManagerWorks(
  probe: SealServiceProbe,
  manager: SealServiceManager
): boolean {
  switch (manager) {
    case 'systemd-user':
      return probe.platform === 'linux' && probe.systemdUser
    case 'launchd':
      return hasLaunchd(probe) && probe.guiSession
    case 'pm2':
      return probe.pm2
  }
}

/** The host's marker first, then the preference. */
function wantedManagers(
  probe: SealServiceProbe,
  wish: SealServiceWish | null
): SealServiceManager[] {
  return [...(probe.installed ? [probe.installed] : []), ...(wish?.prefer ? [wish.prefer] : [])]
}

/** The manager wanted first is launchd, and all it lacks is a login at the screen: no other manager stands in for it. */
export function sealLaunchdNeedsLogin(
  probe: SealServiceProbe,
  wish: SealServiceWish | null
): boolean {
  const wanted = wantedManagers(probe, wish).find(
    (manager) => manager === 'launchd' || sealServiceManagerWorks(probe, manager)
  )
  return wanted === 'launchd' && hasLaunchd(probe) && !probe.guiSession
}

/** Tried in order until one installs; `detached` always ends the list. A null wish installs nothing new. */
export function selectSealServiceCandidates(
  probe: SealServiceProbe,
  wish: SealServiceWish | null
): SealServerKeeper[] {
  // A second server beside the user's own would compete for its port.
  if ((probe.ownServe && !probe.installed) || sealLaunchdNeedsLogin(probe, wish)) {
    return ['detached']
  }
  const managers = [
    ...wantedManagers(probe, wish),
    ...(wish === null ? [] : AUTOMATIC_MANAGERS)
  ].filter((manager) => sealServiceManagerWorks(probe, manager))
  return [...new Set(managers), 'detached']
}
