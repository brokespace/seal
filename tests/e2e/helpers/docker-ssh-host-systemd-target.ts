// A Docker SSH host whose PID 1 is systemd, so a user service, linger and a reboot behave as on a real machine.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestInfo } from '@stablyai/playwright-test'
import { renderSystemdUnit } from '../../../src/cli/runtime/serve-service-unit'
import { quotePosixShell } from '../../../src/shared/shell/launch/shell-argument-quoting'
import { ensureDockerSystemdSshHostImage } from './docker-ssh-host-image'
import {
  cleanupDockerSshHostTarget,
  execDockerSshHostTargetControlCommand,
  runDockerSshHostProcess,
  seedRemoteRepo,
  spawnDockerSshHostProcess,
  waitForSsh,
  type DockerSshHostProcessResult,
  type DockerSshHostTarget
} from './docker-ssh-host-target'
import { systemdCgroupFlags, waitForSystemRunning } from './docker-systemd-boot'
import {
  readListeningSockets,
  readLoopbackListenerPid,
  type ListeningSocket
} from './proc-net-tcp-listeners'
import { reserveLocalPort } from './reserve-local-port'

const SSH_USER = 'seal'
const SSH_USER_UID = 1100
const SSH_USER_HOME = `/home/${SSH_USER}`
const SSH_USER_RUNTIME_DIR = `XDG_RUNTIME_DIR=/run/user/${SSH_USER_UID}`
const INSTALL_ROOT = `${SSH_USER_HOME}/.orca-remote`
// The container may not mount, so both failing disks exist from the start and the install root is pointed at one.
const FULL_DISK = '/mnt/seal-fixture-full-disk'
const READ_ONLY_DISK = '/mnt/seal-fixture-read-only-disk'
const AS_SSH_USER = ['-u', SSH_USER, '-w', SSH_USER_HOME, '-e', SSH_USER_RUNTIME_DIR]
const PORT_TAKEN = /port is already allocated|address already in use/i
const USER_UNIT_DIR = `${SSH_USER_HOME}/.config/systemd/user`
const OWN_SERVE_UNIT = 'seal-serve.service'
/** The port the user's own `seal serve` takes. */
export const OWN_SERVE_PORT = 6768
// Holds the port a real `seal serve` would, so a test can tell whether Seal replaced its owner.
const OWN_SERVE_STAND_IN = [
  '/usr/local/bin/node',
  '-e',
  `require('node:net').createServer().listen(${OWN_SERVE_PORT}, '127.0.0.1')`
]

export type DockerSystemdSshHostOptions = {
  /** false starts the host that refuses `loginctl enable-linger` to its user. */
  polkit?: boolean
  /** The user already lingers before anything connects. */
  linger?: boolean
  /** Defaults to an id the container generates on first boot and keeps across restarts. */
  machineId?: string
}

export type SealServerState = {
  /** `seal-server.service` is active in the SSH user's manager; false when that manager is not running. */
  serviceActive: boolean
  /** Live server processes, from the PID each installed slot records. */
  processIds: number[]
}

export type DockerSystemdSshHost = {
  containerName: string
  /** What Add machine needs; the port is the same after restart(), stop() and start(). */
  ssh: { host: string; port: number; username: string; identityFile: string }
  /** Runs a bash command through `docker exec` (no SSH login) and returns its stdout; throws on a non-zero exit. */
  exec: (command: string, options?: { user?: 'root' | 'seal'; timeoutMs?: number }) => string
  /** `systemctl --user <args>` as the SSH user, without a login. `is-active` and friends report through the exit code. */
  userSystemctl: (args: string[]) => DockerSshHostProcessResult
  lingerEnabled: () => boolean
  /** One line per logind session; empty when nobody is logged in. */
  loginSessions: () => string[]
  /** TCP listeners only. */
  listeningSockets: () => ListeningSocket[]
  /** The process listening on this loopback TCP port, or null. */
  loopbackListenerPid: (port: number) => number | null
  /** Read without a login: a login starts the user's manager, which starts a stopped server again. */
  sealServerState: () => SealServerState
  /**
   * Installs the SSH user's own `seal-serve.service` the way `seal serve service install` does, and starts it.
   * Needs a host started with `linger: true`, as only then does the user's manager run before a login.
   * execStart defaults to a stand-in that listens on 127.0.0.1:6768.
   */
  installOwnServeService: (execStart?: string[]) => void
  reloadSsh: () => void
  /** Reboots the host and returns once systemd is `running` again, without logging in. */
  restart: () => void
  stop: () => void
  start: () => void
  /** Creates a committed repository under the SSH user's home (not /tmp, which a boot empties) and returns its path. */
  seedGitRepository: (name: string) => string
  /** Puts ~/.orca-remote on a 512 KB disk: larger writes fail with ENOSPC. Needs a host with no ~/.orca-remote yet. */
  makeInstallRootOutOfSpace: () => void
  /** Puts ~/.orca-remote on a read-only disk: every write fails with EROFS. Needs a host with no ~/.orca-remote yet. */
  makeInstallRootReadOnly: () => void
  /** Removes whichever install-root failure is in place, leaving no ~/.orca-remote. */
  restoreInstallRoot: () => void
  dispose: () => void
}

let dockerServer: { major: number; cgroupVersion: string } | { unreachable: string } | undefined

function readDockerServer(): NonNullable<typeof dockerServer> {
  if (!dockerServer) {
    const info = spawnDockerSshHostProcess('docker', [
      'info',
      '--format',
      '{{.ServerVersion}} {{.CgroupVersion}}'
    ])
    const [version = '', cgroupVersion = ''] = info.stdout.split(' ')
    const major = Number.parseInt(version, 10)
    dockerServer =
      info.exitCode === 0 && Number.isInteger(major)
        ? { major, cgroupVersion }
        : { unreachable: info.stderr || info.stdout || `exit ${info.exitCode}` }
  }
  return dockerServer
}

/** Why the systemd SSH host cannot run here, or null when it can. */
export function dockerSystemdSshHostUnavailableReason(): string | null {
  if (process.env.ORCA_E2E_SSH_DOCKER !== '1') {
    return 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker SSH hosts'
  }
  const server = readDockerServer()
  if ('unreachable' in server) {
    return `Docker is unreachable: ${server.unreachable}`
  }
  return server.cgroupVersion === '2'
    ? null
    : `systemd in a container needs cgroup v2; docker info reports cgroup v${server.cgroupVersion}`
}

export async function startDockerSystemdSshHost(
  testInfo: Pick<TestInfo, 'workerIndex'>,
  options: DockerSystemdSshHostOptions = {}
): Promise<DockerSystemdSshHost> {
  const server = readDockerServer()
  if ('unreachable' in server) {
    throw new Error(`Docker is unreachable: ${server.unreachable}`)
  }
  const image = ensureDockerSystemdSshHostImage(process.cwd(), options)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'seal-ssh-systemd-'))
  const identityFile = path.join(tempDir, 'id_ed25519')
  const containerName = `seal-ssh-systemd-e2e-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`
  const target: DockerSshHostTarget = {
    containerName,
    containerIp: '',
    host: '127.0.0.1',
    identityFile,
    port: 0,
    tempDir
  }
  const exec: DockerSystemdSshHost['exec'] = (
    command,
    { user = 'root', timeoutMs = 60_000 } = {}
  ) =>
    execDockerSshHostTargetControlCommand(target, command, {
      execFlags: user === 'seal' ? AS_SSH_USER : [],
      timeoutMs
    })

  try {
    runDockerSshHostProcess('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', identityFile, '-q'])
    const publicKey = readFileSync(`${identityFile}.pub`, 'utf8').trim()
    const owner = `uid=${SSH_USER_UID},gid=${SSH_USER_UID},mode=0755`
    // 512 KB is under the 1024 KB the product reads as a full disk.
    // exec: Docker mounts a tmpfs noexec, which the product reports instead of the failure under test.
    const failingDisks = [
      `${FULL_DISK}:size=512k,exec,${owner}`,
      `${READ_ONLY_DISK}:ro,exec,${owner}`
    ]
    const tmpfsMounts = ['/run', '/run/lock', ...failingDisks]
    for (let attempt = 1; target.port === 0; attempt += 1) {
      // An ephemeral published port changes on `docker restart`, so one free port is chosen and pinned.
      const reserved = await reserveLocalPort()
      await reserved.release()
      const started = spawnDockerSshHostProcess(
        'docker',
        [
          'run',
          '-d',
          '--name',
          containerName,
          '-p',
          `127.0.0.1:${reserved.port}:22`,
          ...systemdCgroupFlags(server.major),
          ...tmpfsMounts.flatMap((mount) => ['--tmpfs', mount]),
          '-e',
          `AUTHORIZED_KEY=${publicKey}`,
          ...(options.machineId ? ['-e', `MACHINE_ID=${options.machineId}`] : []),
          ...(options.linger ? ['-e', 'FIXTURE_LINGER=1'] : []),
          image
        ],
        { timeoutMs: 120_000 }
      )
      if (started.exitCode === 0) {
        target.port = reserved.port
      } else {
        spawnDockerSshHostProcess('docker', ['rm', '-f', containerName])
        if (attempt === 3 || !PORT_TAKEN.test(started.stderr)) {
          throw new Error(`docker run ${image} failed: ${started.stderr}`)
        }
      }
    }
    waitForSystemRunning(containerName)
    // Logs in as root, which leaves the SSH user's manager and linger state untouched.
    waitForSsh(target)
  } catch (error) {
    cleanupDockerSshHostTarget(target)
    throw error
  }

  const asSshUser = ['exec', ...AS_SSH_USER, containerName]
  const userSystemctl: DockerSystemdSshHost['userSystemctl'] = (args) =>
    spawnDockerSshHostProcess('docker', [...asSshUser, 'systemctl', '--user', ...args])

  let installRootFailure: 'out of space' | 'read-only' | null = null
  const pointInstallRootAt = (disk: string, failure: typeof installRootFailure): void => {
    if (installRootFailure) {
      throw new Error(`The install root is already ${installRootFailure}`)
    }
    exec(
      `if [ -e ${INSTALL_ROOT} ] || [ -L ${INSTALL_ROOT} ]; then echo '${INSTALL_ROOT} already exists' >&2; exit 1; fi; ` +
        `ln -s ${disk} ${INSTALL_ROOT}`,
      { user: 'seal' }
    )
    installRootFailure = failure
  }

  return {
    containerName,
    ssh: { host: target.host, port: target.port, username: SSH_USER, identityFile },
    exec,
    userSystemctl,
    // show-user fails for a user who neither lingers nor is logged in.
    lingerEnabled: () =>
      exec(`loginctl show-user ${SSH_USER} -p Linger --value 2>/dev/null || echo no`) === 'yes',
    loginSessions: () =>
      exec('loginctl list-sessions --no-legend')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    listeningSockets: () => readListeningSockets(exec),
    loopbackListenerPid: (port) => readLoopbackListenerPid(exec, port),
    sealServerState: () => ({
      serviceActive: userSystemctl(['is-active', 'seal-server.service']).stdout === 'active',
      processIds: exec(
        `for f in ${INSTALL_ROOT}/*/.orcad-pid; do pid=$(cat "$f" 2>/dev/null) && ` +
          'kill -0 "$pid" 2>/dev/null && echo "$pid"; done; true'
      )
        .split('\n')
        .filter(Boolean)
        .map(Number)
    }),
    installOwnServeService: (execStart = OWN_SERVE_STAND_IN) => {
      const unit = quotePosixShell(renderSystemdUnit(execStart, {}))
      exec(
        `mkdir -p ${USER_UNIT_DIR} && printf '%s' ${unit} > ${USER_UNIT_DIR}/${OWN_SERVE_UNIT} && ` +
          `systemctl --user daemon-reload && systemctl --user enable ${OWN_SERVE_UNIT} && ` +
          `systemctl --user restart ${OWN_SERVE_UNIT}`,
        { user: 'seal' }
      )
    },
    reloadSsh: () => exec('systemctl reload ssh'),
    restart: () => {
      runDockerSshHostProcess('docker', ['restart', containerName], { timeoutMs: 60_000 })
      waitForSystemRunning(containerName)
    },
    stop: () => runDockerSshHostProcess('docker', ['stop', containerName], { timeoutMs: 60_000 }),
    start: () => {
      runDockerSshHostProcess('docker', ['start', containerName], { timeoutMs: 60_000 })
      waitForSystemRunning(containerName)
    },
    seedGitRepository: (name) => {
      const repoPath = `${SSH_USER_HOME}/projects/${name}`
      seedRemoteRepo(target, repoPath)
      exec(`chown -R ${SSH_USER}:${SSH_USER} ${quotePosixShell(`${SSH_USER_HOME}/projects`)}`)
      return repoPath
    },
    makeInstallRootOutOfSpace: () => pointInstallRootAt(FULL_DISK, 'out of space'),
    makeInstallRootReadOnly: () => pointInstallRootAt(READ_ONLY_DISK, 'read-only'),
    restoreInstallRoot: () => {
      if (!installRootFailure) {
        return
      }
      exec(
        `if [ -L ${INSTALL_ROOT} ]; then rm ${INSTALL_ROOT}; fi; find ${FULL_DISK} -mindepth 1 -delete`
      )
      installRootFailure = null
    },
    dispose: () => cleanupDockerSshHostTarget(target)
  }
}
