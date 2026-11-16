/** Which service manager keeps the server running, from what one probe of the host answered. */
import type { SealServerKeeper, SealServiceManager, SealServiceWish } from './seal-service-policy'

export type SealServiceProbe = {
  platform: 'linux' | 'darwin' | 'other'
  /** `systemctl --user show-environment` succeeded. */
  systemdUser: boolean
  launchctl: boolean
  /** `pm2` is on the launching shell's PATH. */
  pm2: boolean
  /** The manager the host's marker names: the truth for every desktop that connects. */
  installed: SealServiceManager | null
  /** The installed manager still holds the service and the launcher is in place. */
  registered: boolean
  /** systemd: null when logind did not answer. */
  linger: boolean | null
  /** The user's own `pm2 startup`; null when it cannot be told. */
  pm2StartsAtBoot: boolean | null
}

export function sealServiceManagerWorks(
  probe: SealServiceProbe,
  manager: SealServiceManager
): boolean {
  switch (manager) {
    case 'systemd-user':
      return probe.platform === 'linux' && probe.systemdUser
    case 'launchd':
      return probe.platform === 'darwin' && probe.launchctl
    case 'pm2':
      return probe.pm2
  }
}

/** Tried in order until one installs; `detached` always ends the list. A null wish installs nothing new. */
export function selectSealServiceCandidates(
  probe: SealServiceProbe,
  wish: SealServiceWish | null
): SealServerKeeper[] {
  const native: SealServiceManager[] =
    probe.platform === 'linux' ? ['systemd-user'] : probe.platform === 'darwin' ? ['launchd'] : []
  const wished: SealServiceManager[] =
    wish === null ? [] : wish.prefer === 'pm2' ? ['pm2', ...native] : [...native, 'pm2']
  const managers = [...(probe.installed ? [probe.installed] : []), ...wished].filter((manager) =>
    sealServiceManagerWorks(probe, manager)
  )
  return [...new Set(managers), 'detached']
}
