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
import { orcadWindowsBaseDir } from '../install/orcad-remote-windows-node'
import { dropSealServerLaunchRecordCommand } from './seal-server-launch-record'
import {
  parseSealServiceInstallAnswer,
  SEAL_ENABLE_LINGER_COMMAND,
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
  parseSealLinger,
  parseSealServiceAnswer,
  parseSealServiceProbe,
  sealDetachedOutcome,
  sealServiceOutcome,
  sealServiceProbeCommand
} from './seal-service-probe'

/** `execOrcadRemote` for the launch's target, so every step is under the activation fence. */
export type SealServiceRemoteRun = (command: string) => Promise<string>

type SealServiceLaunchTarget = { conn: OrcadHostTransport; host: RemoteHostPlatform }

/** Null for WSL and for a transport outside the SSH stack, which may not name a target. */
export function sshHostTargetId(conn: OrcadHostTransport): string | null {
  const hostTarget = conn.getTarget?.()
  return hostTarget && !isWslOrcadHostTarget(hostTarget) ? hostTarget.id : null
}

/** Null for WSL, Windows and transports that bring their own launch strategy. */
function sshTargetId(target: SealServiceLaunchTarget): string | null {
  if (isWindowsRemoteHost(target.host) || target.conn.orcadLaunchDetach !== undefined) {
    return null
  }
  return sshHostTargetId(target.conn)
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

/** An install cut short before linger was asked for leaves a service that stops at logout. */
async function withLinger(
  run: SealServiceRemoteRun,
  manager: SealServiceManager,
  probe: SealServiceProbe
): Promise<SealServiceProbe> {
  if (manager !== 'systemd-user' || probe.linger === true) {
    return probe
  }
  try {
    const answer = parseSealServiceAnswer(await run(SEAL_ENABLE_LINGER_COMMAND))
    return { ...probe, linger: parseSealLinger(answer.get('linger')) }
  } catch (error) {
    if (endsTheLaunch(error)) {
      throw error
    }
    return probe
  }
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
        ? sealServiceOutcome(manager, await withLinger(run, manager, probe))
        : await installWith(run, manager, managedRoot, probe)
    if (outcome) {
      return { manager, outcome }
    }
  }
  return null
}

/** A manager that still holds the service would otherwise start the recorded slot beside the detached server. */
async function dropLaunchRecord(run: SealServiceRemoteRun, managedRoot: string): Promise<void> {
  try {
    await run(dropSealServerLaunchRecordCommand(managedRoot))
  } catch (error) {
    if (endsTheLaunch(error)) {
      throw error
    }
    console.warn(`[seal-service] the launch record could not be removed: ${errorMessage(error)}`)
  }
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
  // Host-neutral despite its name: the folder above the install slot.
  const managedRoot = orcadWindowsBaseDir(target.host, spec.remoteInstallDir)
  // The unit and plist need the launcher's absolute path.
  if (targetId === null || !managedRoot.startsWith('/')) {
    return null
  }
  const wish = sealServiceWish(targetId)
  const probe = await probeHost(run, managedRoot)
  if (probe && !probe.installed && wish === null) {
    return null
  }
  if (probe?.ownServe && !probe.installed) {
    console.info(
      `[seal-service] ${probe.ownServe.name} already keeps a Seal server running on this host; no service is registered beside it`
    )
  }
  const kept = probe && (await keepRunningWith(run, managedRoot, probe, wish))
  // An unanswered probe may hide a marker.
  if (!kept && (!probe || probe.installed)) {
    await dropLaunchRecord(run, managedRoot)
  }
  if (probe?.installed || wish !== null) {
    reportSealServiceOutcome(targetId, kept?.outcome ?? sealDetachedOutcome(probe, wish))
  }
  return kept ? { service: kept.manager } : null
}
