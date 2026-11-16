/** A server the user runs, on a machine Seal also reaches over SSH: the machine's own CLI installs and reports its service. */
import type { MachineView } from '../../../shared/machines/machine-view'
import { INSTALLED_CLI_COMMAND_NAME } from '../../cli/installation/cli-install-constants'
import { isRecord } from '../../home-chat/home-chat-record-guard'
import type { SealServiceOutcome } from '../../managed-server/service/seal-service-policy'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { execCommand, isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { buildSshLoginShellCommand } from '../../ssh/remote-exec/ssh-login-shell-command'
import { isWindowsRemoteHost } from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import {
  latestSealServiceOutcome,
  noteSealServiceOutcome,
  whileSshConnectsDirectly
} from './machine-server-install-activity'
import { connectedSshSession, sshSessionTo } from './machine-ssh-session'
import { sealDeployedServer } from './seal-deployed-server'

const SERVICE_COMMAND = `${INSTALLED_CLI_COMMAND_NAME} serve service`
const STATUS_TIMEOUT_MS = 30_000
// The CLI gives each of its service manager calls 20 s.
const INSTALL_TIMEOUT_MS = 120_000
const COMMAND_NOT_FOUND_EXIT = 127

const asked = new Set<string>()

type ServiceVerb = 'install' | 'status'

/** The CLI's `--json` answer; null when the output holds none. */
function cliAnswer(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end < start) {
    return null
  }
  try {
    const answer: unknown = JSON.parse(output.slice(start, end + 1))
    return isRecord(answer) ? answer : null
  } catch {
    return null
  }
}

async function runServiceCommand(
  conn: SshConnection,
  verb: ServiceVerb,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const host = await detectRemoteHostPlatform(conn)
  if (!host || isWindowsRemoteHost(host)) {
    throw new Error('Seal can keep a server running as a service only on Linux and macOS machines')
  }
  // The user's own login shell holds the PATH that finds the CLI, and the service inherits it.
  const shell = (
    await execCommand(conn, 'echo "${SHELL:-/bin/sh}"', { timeoutMs: STATUS_TIMEOUT_MS })
  )
    .trim()
    .split('\n')[0]
  const command = `${SERVICE_COMMAND} ${verb} --json`
  const login = buildSshLoginShellCommand(shell || '/bin/sh', command)
  let stderr = ''
  let exitCode = 0
  const stdout = await execCommand(conn, login.command, {
    wrapCommand: false,
    timeoutMs,
    onStderr: (chunk) => {
      stderr += chunk
    }
  }).catch((error: unknown) => {
    if (!isSshCommandExitError(error)) {
      throw error
    }
    exitCode = error.exitCode
    return error.stdout
  })
  const output = login.readStdout(stdout) ?? stdout
  const answer = cliAnswer(output)
  if (answer?.ok === true && isRecord(answer.result)) {
    return answer.result
  }
  if (answer && isRecord(answer.error) && typeof answer.error.message === 'string') {
    throw new Error(answer.error.message)
  }
  const said = `${stderr}\n${output}`.trim()
  if (exitCode === COMMAND_NOT_FOUND_EXIT || /not found|unknown command/iu.test(said)) {
    throw new Error(
      `Seal's command-line tool was not found on this machine over SSH. Run this on the machine: ${SERVICE_COMMAND} install`
    )
  }
  throw new Error(
    `The machine did not answer "${command}"${said ? `: ${said.split(/\r?\n/u)[0]}` : ''}`
  )
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

async function closeSessionOpenedHere(sshTargetId: string): Promise<void> {
  try {
    // Import lazily: the SSH teardown wires the whole SSH stack, and only this one-off needs it.
    const { disconnectRegisteredSshTarget } = await import('../../ipc/ssh/ssh-session-teardown')
    await disconnectRegisteredSshTarget(sshTargetId)
  } catch (error) {
    console.warn('[machines] could not close the SSH session opened for a service install:', error)
  }
}

/** Makes the user's server a service through its own CLI; a session that was already open stays. */
export async function keepOwnServerRunning(sshTargetId: string): Promise<void> {
  const open = connectedSshSession(sshTargetId)
  const session =
    open ?? (await whileSshConnectsDirectly(sshTargetId, () => sshSessionTo(sshTargetId)))
  asked.add(sshTargetId)
  try {
    // An install restarts the service, so a server that already is one is left alone.
    const kept = await readOwnServerService(session).catch(() => null)
    noteSealServiceOutcome(
      sshTargetId,
      kept && kept.manager !== 'detached' ? kept : await installOwnServerService(session)
    )
  } finally {
    if (!open) {
      await closeSessionOpenedHere(sshTargetId)
    }
  }
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
