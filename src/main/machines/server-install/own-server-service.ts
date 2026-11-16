/** A server the user runs, on a machine Seal also reaches over SSH: the machine's own CLI installs and reports its service. */
import type { MachineView } from '../../../shared/machines/machine-view'
import { INSTALLED_CLI_COMMAND_NAME } from '../../cli/installation/cli-install-constants'
import type { SealServiceOutcome } from '../../managed-server/service/seal-service-policy'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { isWindowsRemoteHost } from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import { latestSealServiceOutcome, noteSealServiceOutcome } from './machine-server-install-activity'
import { connectedSshSession, onPlainSshSession } from './machine-ssh-session'
import { runOwnSealCli } from './own-seal-cli-command'
import { sealDeployedServer } from './seal-deployed-server'

const SERVICE_ARGS = 'serve service'
const STATUS_TIMEOUT_MS = 30_000
// The CLI gives each of its service manager calls 20 s.
const INSTALL_TIMEOUT_MS = 120_000

const asked = new Set<string>()

type ServiceVerb = 'install' | 'status'

async function runServiceCommand(
  conn: SshConnection,
  verb: ServiceVerb,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const host = await detectRemoteHostPlatform(conn)
  if (!host || isWindowsRemoteHost(host)) {
    throw new Error('Seal can keep a server running as a service only on Linux and macOS machines')
  }
  // The service inherits the PATH of the login shell the CLI runs in.
  return runOwnSealCli(conn, `${SERVICE_ARGS} ${verb}`, {
    timeoutMs,
    whenNotFound: `Run this on the machine: ${INSTALLED_CLI_COMMAND_NAME} ${SERVICE_ARGS} install`
  })
}

function serviceManagerOf(result: Record<string, unknown>): 'systemd-user' | 'launchd' | null {
  return result.manager === 'systemd'
    ? 'systemd-user'
    : result.manager === 'launchd'
      ? 'launchd'
      : null
}

async function installOwnServerService(conn: SshConnection): Promise<SealServiceOutcome> {
  const result = await runServiceCommand(conn, 'install', INSTALL_TIMEOUT_MS)
  const manager = serviceManagerOf(result)
  if (result.installed !== true || !manager) {
    throw new Error('The machine did not confirm that its Seal server is now a service')
  }
  return {
    manager,
    ...(result.linger === 'yes' || result.linger === 'no'
      ? { linger: result.linger === 'yes' }
      : {})
  }
}

/** Null when the machine's service manager cannot tell. */
async function readOwnServerService(conn: SshConnection): Promise<SealServiceOutcome | null> {
  const result = await runServiceCommand(conn, 'status', STATUS_TIMEOUT_MS)
  const manager = serviceManagerOf(result)
  if (result.verdict === 'unverifiable') {
    return null
  }
  return result.installed === true && result.verdict === 'live' && manager
    ? { manager }
    : { manager: 'detached' }
}

/** Makes the user's server a service through its own CLI; a session that was already open stays. */
export async function keepOwnServerRunning(sshTargetId: string): Promise<void> {
  asked.add(sshTargetId)
  await onPlainSshSession(sshTargetId, async (session) => {
    // An install restarts the service, so a server that already is one is left alone.
    const kept = await readOwnServerService(session).catch(() => null)
    noteSealServiceOutcome(
      sshTargetId,
      kept && kept.manager !== 'detached' ? kept : await installOwnServerService(session)
    )
  })
}

/** Asks each such machine once per app run, and only over an SSH session that is already open. */
export function learnOwnServerServices(views: readonly MachineView[]): void {
  for (const view of views) {
    const sshTargetId = view.ssh?.targetId
    const environmentId = view.server?.environmentId
    if (
      view.connection !== 'server' ||
      view.serverInstallAction !== 'keep-running' ||
      !sshTargetId ||
      !environmentId ||
      asked.has(sshTargetId)
    ) {
      continue
    }
    const session = connectedSshSession(sshTargetId)
    if (!session || sealDeployedServer({ sshTargetId, environmentId })) {
      continue
    }
    asked.add(sshTargetId)
    void readOwnServerService(session)
      .then((kept) => {
        if (kept && !latestSealServiceOutcome(sshTargetId)) {
          noteSealServiceOutcome(sshTargetId, kept)
        }
      })
      .catch((error: unknown) => {
        console.info(
          '[machines] could not read whether the server on a machine runs as a service:',
          error instanceof Error ? error.message : error
        )
      })
  }
}
