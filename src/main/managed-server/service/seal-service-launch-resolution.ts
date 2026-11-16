/** Before each managed launch: does a service manager on the host start the server, and which one. */
import { errorMessage } from '../../../shared/error-message'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { OrcadFenceLostError } from '../activation/orcad-activation-fence-scope'
import { isWslOrcadHostTarget, type OrcadHostTransport } from '../install/orcad-host-transport'
import type { OrcadLaunchSpec } from '../install/orcad-remote-launch'
import { sealServiceManagedRoot } from './seal-server-launch-record'
import {
  parseSealServiceInstallAnswer,
  sealServiceInstallCommand
} from './seal-service-install-commands'
import {
  selectSealServiceCandidates,
  type SealServiceProbe
} from './seal-service-manager-selection'
import {
  reportSealServiceOutcome,
  sealServiceWish,
  type SealServiceManager,
  type SealServiceOutcome,
  type SealServiceWish
} from './seal-service-policy'
import {
  parseSealServiceProbe,
  sealServiceOutcome,
  sealServiceProbeCommand
} from './seal-service-probe'

/** `execOrcadRemote` for the launch's target, so every step is under the activation fence. */
export type SealServiceRemoteRun = (command: string) => Promise<string>

type SealServiceLaunchTarget = { conn: OrcadHostTransport; host: RemoteHostPlatform }

/** Null for WSL, Windows and transports that bring their own launch strategy. */
function sshTargetId(target: SealServiceLaunchTarget): string | null {
  if (isWindowsRemoteHost(target.host) || target.conn.orcadLaunchDetach !== undefined) {
    return null
  }
  const hostTarget = target.conn.getTarget?.()
  return hostTarget && !isWslOrcadHostTarget(hostTarget) ? hostTarget.id : null
}

/** A lost fence or an unconfirmed command says nothing about the manager and must stop the launch. */
function endsTheLaunch(error: unknown): boolean {
  return (
    isUnconfirmedSshCommandTermination(error) ||
    error instanceof OrcadFenceLostError ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

async function probeHost(
  run: SealServiceRemoteRun,
  managedRoot: string
): Promise<SealServiceProbe | null> {
  try {
    return parseSealServiceProbe(await run(sealServiceProbeCommand(managedRoot)))
  } catch (error) {
    if (endsTheLaunch(error)) {
      throw error
    }
    console.warn(`[seal-service] probe failed: ${errorMessage(error)}`)
    return null
  }
}

async function installWith(
  run: SealServiceRemoteRun,
  manager: SealServiceManager,
  managedRoot: string,
  probe: SealServiceProbe
): Promise<SealServiceOutcome | null> {
  try {
    const answer = parseSealServiceInstallAnswer(
      await run(sealServiceInstallCommand({ manager, managedRoot, replaces: probe.installed }))
    )
    if (answer.installed) {
      return sealServiceOutcome(manager, { ...probe, linger: answer.linger })
    }
    console.warn(`[seal-service] ${manager} refused the service: ${answer.reason ?? 'no reason'}`)
  } catch (error) {
    if (endsTheLaunch(error)) {
      throw error
    }
    console.warn(`[seal-service] ${manager} install failed: ${errorMessage(error)}`)
  }
  return null
}

/** The first candidate that holds the service, installing it where the host has none yet. */
async function keepRunningWith(
  run: SealServiceRemoteRun,
  managedRoot: string,
  probe: SealServiceProbe,
  wish: SealServiceWish | null
): Promise<{ manager: SealServiceManager; outcome: SealServiceOutcome } | null> {
  for (const manager of selectSealServiceCandidates(probe, wish)) {
    if (manager === 'detached') {
      break
    }
    const outcome =
      manager === probe.installed && probe.registered
        ? sealServiceOutcome(manager, probe)
        : await installWith(run, manager, managedRoot, probe)
    if (outcome) {
      return { manager, outcome }
    }
  }
  return null
}

/**
 * The host's marker is the truth: a host that has a service is launched through it by every desktop.
 * A host without one gets a service only when the machine registry wishes it. Null keeps the detached launch.
 */
export async function resolveSealServiceLaunch(
  target: SealServiceLaunchTarget,
  spec: Pick<OrcadLaunchSpec, 'remoteInstallDir'>,
  run: SealServiceRemoteRun
): Promise<{ service: SealServiceManager } | null> {
  const targetId = sshTargetId(target)
  const managedRoot = sealServiceManagedRoot(target.host, spec.remoteInstallDir)
  // The unit and plist need the launcher's absolute path.
  if (targetId === null || !managedRoot.startsWith('/')) {
    return null
  }
  const wish = sealServiceWish(targetId)
  const probe = await probeHost(run, managedRoot)
  if (!probe?.installed && wish === null) {
    return null
  }
  const kept = probe && (await keepRunningWith(run, managedRoot, probe, wish))
  reportSealServiceOutcome(targetId, kept?.outcome ?? { manager: 'detached' })
  return kept ? { service: kept.manager } : null
}
