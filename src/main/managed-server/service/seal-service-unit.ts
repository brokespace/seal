/** The systemd user unit and launchd agent for the managed launcher, from the renderers `seal serve service install` uses. */
import { renderLaunchAgent, renderSystemdUnit } from '../../../cli/runtime/serve-service-unit'
import {
  SEAL_SERVICE_LAUNCHD_LABEL,
  sealServiceLauncherLogPath,
  sealServiceLauncherPath
} from './seal-service-host-layout'

// No environment in either: the launch record sets it, so PM2 runs the server the same way.

export function renderSealServiceSystemdUnit(managedRoot: string): string {
  return renderSystemdUnit(
    [sealServiceLauncherPath(managedRoot)],
    {},
    'Seal server (managed over SSH)'
  )
}

/**
 * AbandonProcessGroup: launchd must not kill the terminal daemon when the server exits.
 * Aqua: only the login at the screen loads the agent, so an SSH session never starts a second copy.
 */
export function renderSealServiceLaunchAgent(managedRoot: string): string {
  return renderLaunchAgent(
    SEAL_SERVICE_LAUNCHD_LABEL,
    [sealServiceLauncherPath(managedRoot)],
    {},
    sealServiceLauncherLogPath(managedRoot),
    { abandonProcessGroup: true, limitLoadToSessionType: 'Aqua' }
  )
}
