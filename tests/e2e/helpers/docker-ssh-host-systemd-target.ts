// A Docker SSH host whose PID 1 is systemd, so a user service, linger and a reboot behave as on a real machine.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestInfo } from '@stablyai/playwright-test'
import { quotePosixShell } from '../../../src/shared/shell/launch/shell-argument-quoting'
import { hashDockerFixtureDirectory } from './docker-ssh-host-image'
import {
  cleanupDockerSshHostTarget,
  seedRemoteRepo,
  waitForSsh,
  type DockerSshHostTarget
} from './docker-ssh-host-target'
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
const BOOT_TIMEOUT_MS = 60_000
const IPV6_ANY = '0'.repeat(32)
const IPV6_LOOPBACK = `${'0'.repeat(24)}01000000`
const IPV4_MAPPED = `${'0'.repeat(16)}FFFF0000`
const PORT_TAKEN = /port is already allocated|address already in use/i

export type DockerSystemdSshHostOptions = {
  /** false starts the host that refuses `loginctl enable-linger` to its user. */
  polkit?: boolean
  /** The user already lingers before anything connects. */
  linger?: boolean
  /** Defaults to an id the container generates on first boot and keeps across restarts. */
  machineId?: string
}

export type DockerCommandResult = { exitCode: number; stdout: string; stderr: string }

export type ListeningSocket = { address: string; port: number; loopback: boolean }

export type DockerSystemdSshHost = {
  containerName: string
  /** What Add machine needs; the port is the same after restart(), stop() and start(). */
  ssh: { host: string; port: number; username: string; identityFile: string }
  /** Runs a bash command through `docker exec` (no SSH login) and returns its stdout; throws on a non-zero exit. */
  exec: (command: string, options?: { user?: 'root' | 'seal'; timeoutMs?: number }) => string
  /** `systemctl --user <args>` as the SSH user, without a login. `is-active` and friends report through the exit code. */
  userSystemctl: (args: string[]) => DockerCommandResult
  lingerEnabled: () => boolean
  /** One line per logind session; empty when nobody is logged in. */
  loginSessions: () => string[]
  /** TCP listeners only. */
  listeningSockets: () => ListeningSocket[]
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

function run(command: string, args: string[], timeoutMs = 30_000): DockerCommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs
  })
  return {
    exitCode: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim() || (result.error?.message ?? '')
  }
}

function runOrThrow(command: string, args: string[], timeoutMs?: number): string {
  const result = run(command, args, timeoutMs)
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.exitCode}: ${result.stderr || result.stdout}`
    )
  }
  return result.stdout
}

let dockerServer: { major: number; cgroupVersion: string } | { unreachable: string } | undefined

function readDockerServer(): NonNullable<typeof dockerServer> {
  if (!dockerServer) {
    const info = run('docker', ['info', '--format', '{{.ServerVersion}} {{.CgroupVersion}}'])
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

/** Builds the image unless this fixture's content is already built, and returns its tag. */
export function ensureDockerSystemdSshHostImage(
  root: string,
  options: Pick<DockerSystemdSshHostOptions, 'polkit'> = {}
): string {
  const fixtureDir = path.join(root, 'tests', 'e2e', 'fixtures', 'docker-ssh-host-systemd')
  const polkit = options.polkit ?? true
  const image = `seal-e2e-ssh-host-systemd:${hashDockerFixtureDirectory(fixtureDir)}${polkit ? '' : '-nopolkit'}`
  if (run('docker', ['image', 'inspect', image]).exitCode === 0) {
    return image
  }
  const polkitArg = polkit ? [] : ['--build-arg', 'POLKIT=']
  execFileSync('docker', ['build', '--tag', image, ...polkitArg, fixtureDir], {
    stdio: 'inherit',
    timeout: 300_000
  })
  return image
}

// --privileged also boots systemd, but lets it write its sysctls into the host kernel.
function systemdCgroupFlags(dockerMajor: number): string[] {
  return dockerMajor >= 28
    ? ['--security-opt', 'writable-cgroups=true']
    : ['--cgroupns=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw']
}

function bootDiagnostics(containerName: string): string {
  const state = run('docker', [
    'inspect',
    '-f',
    '{{.State.Status}} {{.State.ExitCode}}',
    containerName
  ])
  const failed = run('docker', ['exec', containerName, 'systemctl', '--failed', '--no-legend'])
  const logs = run('docker', ['logs', '--tail', '200', containerName])
  return [
    `container: ${state.stdout || state.stderr}`,
    `failed units: ${failed.stdout || failed.stderr || 'none'}`,
    `docker logs: ${[logs.stdout, logs.stderr].filter(Boolean).join('\n') || '(empty)'}`
  ].join('\n')
}

function waitForSystemRunning(containerName: string): void {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  const isSystemRunning = ['exec', containerName, 'systemctl', 'is-system-running', '--wait']
  let boot = run('docker', isSystemRunning, BOOT_TIMEOUT_MS)
  // --wait blocks until the boot ends, so this loops only while systemd's bus is not up yet ("offline").
  const busIsDown = (): boolean => boot.stdout === '' || boot.stdout === 'offline'
  while (busIsDown() && !/is not running/.test(boot.stderr) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    boot = run('docker', isSystemRunning, Math.max(1_000, deadline - Date.now()))
  }
  if (boot.stdout !== 'running') {
    throw new Error(
      `systemd in ${containerName} did not reach "running": ${boot.stdout || boot.stderr}\n${bootDiagnostics(containerName)}`
    )
  }
}

function socketAddress(hex: string): string {
  if (hex === IPV6_ANY || hex === IPV6_LOOPBACK) {
    return hex === IPV6_ANY ? '::' : '::1'
  }
  const ipv4 = hex.length === 8 ? hex : hex.startsWith(IPV4_MAPPED) ? hex.slice(24) : null
  // /proc/net/tcp prints an IPv4 address in host byte order.
  const bytes = (ipv4?.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16))
  return ipv4 ? bytes.toReversed().join('.') : hex
}

function parseListeningSockets(procNetTcp: string): ListeningSocket[] {
  return procNetTcp.split('\n').flatMap((line) => {
    const [, local = '', , state] = line.trim().split(/\s+/)
    if (state !== '0A') {
      return []
    }
    const [hex = '', port = ''] = local.split(':')
    const address = socketAddress(hex)
    const loopback = address === '::1' || address.startsWith('127.')
    return [{ address, port: Number.parseInt(port, 16), loopback }]
  })
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
  const execAs = { root: ['exec', containerName], seal: ['exec', ...AS_SSH_USER, containerName] }
  const exec: DockerSystemdSshHost['exec'] = (
    command,
    { user = 'root', timeoutMs = 60_000 } = {}
  ) => runOrThrow('docker', [...execAs[user], 'bash', '-c', command], timeoutMs)

  try {
    runOrThrow('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', identityFile, '-q'])
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
      const started = run(
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
        120_000
      )
      if (started.exitCode === 0) {
        target.port = reserved.port
      } else {
        run('docker', ['rm', '-f', containerName])
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
    userSystemctl: (args) => run('docker', [...execAs.seal, 'systemctl', '--user', ...args]),
    // show-user fails for a user who neither lingers nor is logged in.
    lingerEnabled: () =>
      exec(`loginctl show-user ${SSH_USER} -p Linger --value 2>/dev/null || echo no`) === 'yes',
    loginSessions: () =>
      exec('loginctl list-sessions --no-legend')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    listeningSockets: () => parseListeningSockets(exec('cat /proc/net/tcp /proc/net/tcp6')),
    reloadSsh: () => exec('systemctl reload ssh'),
    restart: () => {
      runOrThrow('docker', ['restart', containerName], 60_000)
      waitForSystemRunning(containerName)
    },
    stop: () => runOrThrow('docker', ['stop', containerName], 60_000),
    start: () => {
      runOrThrow('docker', ['start', containerName], 60_000)
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
