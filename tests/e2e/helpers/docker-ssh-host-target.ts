import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDockerSshHostImage } from './docker-ssh-host-image'
import { quotePosixShell } from '../../../src/shared/shell/launch/shell-argument-quoting'

import type { TestInfo } from '@stablyai/playwright-test'

export const DOCKER_SSH_HOST_REMOTE_REPO_PATH = '/tmp/orca-docker-relay-perf-repo'

export type DockerSshHostTarget = {
  containerName: string
  containerIp: string
  host: string
  identityFile: string
  port: number
  tempDir: string
}

export type DockerSshHostProcessResult = { exitCode: number; stdout: string; stderr: string }

/** Runs a local CLI (docker, ssh-keygen) for a Docker SSH host; a failure is reported in the result, never thrown. */
export function spawnDockerSshHostProcess(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): DockerSshHostProcessResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs ?? 30_000
  })
  return {
    exitCode: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim() || (result.error?.message ?? '')
  }
}

/** Returns stdout; throws on a non-zero exit. */
export function runDockerSshHostProcess(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): string {
  const result = spawnDockerSshHostProcess(command, args, opts)
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')} (exit ${result.exitCode})\n${result.stderr || result.stdout}`
    )
  }
  return result.stdout
}

export function execDockerSshHostTargetCommand(
  target: DockerSshHostTarget,
  command: string
): string {
  return runDockerSshHostProcess('docker', ['exec', target.containerName, 'bash', '-lc', command], {
    timeoutMs: 60_000
  })
}

export function execDockerSshHostTargetControlCommand(
  target: DockerSshHostTarget,
  command: string,
  /** execFlags are `docker exec` flags such as `-u`. */
  opts: { execFlags?: string[]; timeoutMs?: number } = {}
): string {
  return runDockerSshHostProcess(
    'docker',
    [
      'exec',
      ...(opts.execFlags ?? []),
      target.containerName,
      'bash',
      '--noprofile',
      '--norc',
      '-c',
      command
    ],
    { timeoutMs: opts.timeoutMs }
  )
}

function sshArgs(target: DockerSshHostTarget, command: string): string[] {
  return [
    '-i',
    target.identityFile,
    '-p',
    String(target.port),
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    `root@${target.host}`,
    command
  ]
}

export function waitForSsh(target: DockerSshHostTarget): void {
  const deadline = Date.now() + 90_000
  let lastError = ''
  while (Date.now() < deadline) {
    const result = spawnSync('ssh', sshArgs(target, 'true'), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000
    })
    if (result.status === 0) {
      return
    }
    lastError = result.stderr || result.stdout || `exit ${result.status}`
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000)
  }
  const logs = spawnSync('docker', ['logs', target.containerName], {
    encoding: 'utf8',
    timeout: 10_000
  })
  throw new Error(
    `Timed out waiting for Docker SSH target: ${lastError}\n${logs.stderr || logs.stdout}`
  )
}

export function seedRemoteRepo(target: DockerSshHostTarget, repoPath: string): void {
  const sentinel = `${target.containerName}:${repoPath}`
  execDockerSshHostTargetCommand(
    target,
    [
      `rm -rf ${quotePosixShell(repoPath)}`,
      `mkdir -p ${quotePosixShell(repoPath)}`,
      `cd ${quotePosixShell(repoPath)}`,
      'git init',
      'git config user.email e2e@test.local',
      'git config user.name "Seal Docker SSH E2E"',
      `printf '%s\\n' ${quotePosixShell(sentinel)} > .orca-e2e-destination-id`,
      `printf '%s\\n' ${quotePosixShell(`remote relay ${sentinel}`)} > README.md`,
      'git add README.md .orca-e2e-destination-id',
      'git commit -m initial'
    ].join(' && ')
  )
}

// Probe a closed port: permitted forwarding fails to connect, while denied forwarding reports administratively prohibited.
function probeDockerSshHostTargetForwarding(target: DockerSshHostTarget): string {
  const result = spawnSync(
    'ssh',
    [
      '-i',
      target.identityFile,
      '-p',
      String(target.port),
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-W',
      '127.0.0.1:9',
      `root@${target.host}`
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }
  )
  return result.stderr || result.stdout || `exit ${result.status}`
}

// HUP sshd at PID 1 to reread policy without killing its container; only later connections see the change.
// Confirm refusal with a real SSH probe before the app connects.
export function blockDockerSshHostTargetTcpForwarding(target: DockerSshHostTarget): void {
  execDockerSshHostTargetControlCommand(
    target,
    "printf '%s\\n' 'AllowTcpForwarding no' >> /etc/ssh/sshd_config; kill -HUP 1"
  )
  const deadline = Date.now() + 60_000
  let lastProbe = ''
  while (Date.now() < deadline) {
    lastProbe = probeDockerSshHostTargetForwarding(target)
    if (/administratively prohibited/i.test(lastProbe)) {
      return
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  throw new Error(
    `sshd never began refusing TCP forwarding after AllowTcpForwarding no: ${lastProbe}`
  )
}

export function writeDockerSshHostTargetFile(
  target: DockerSshHostTarget,
  filePath: string,
  contents: string
): void {
  execDockerSshHostTargetCommand(
    target,
    `printf '%s' ${quotePosixShell(contents)} > ${quotePosixShell(filePath)}`
  )
}

export function startDockerSshHostTarget(
  testInfo: Pick<TestInfo, 'workerIndex'>,
  /** A Docker volume mounted as `/root`, so several containers share one home as on NFS. */
  options: { sharedHomeVolume?: string } = {}
): DockerSshHostTarget {
  const host = process.env.ORCA_E2E_SSH_TARGET_HOST?.trim() || '127.0.0.1'
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) {
    if (process.env.ORCA_E2E_SSH_TARGET_HOST) {
      throw new Error(`ORCA_E2E_SSH_TARGET_HOST must be non-loopback: ${host}`)
    }
  }
  const bindHost = host === '127.0.0.1' ? host : '0.0.0.0'
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'orca-ssh-docker-'))
  const identityFile = path.join(tempDir, 'id_ed25519')
  runDockerSshHostProcess('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', identityFile, '-q'])
  const publicKey = readFileSync(`${identityFile}.pub`, 'utf8').trim()
  const containerName = `orca-ssh-e2e-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`
  let target: DockerSshHostTarget | null = null

  try {
    spawnDockerSshHostProcess('docker', ['rm', '-f', containerName], { timeoutMs: 10_000 })
    runDockerSshHostProcess(
      'docker',
      [
        'run',
        '-d',
        '--name',
        containerName,
        '-p',
        `${bindHost}::22`,
        // Each container is its own machine, so it gets its own machine-id.
        ...(options.sharedHomeVolume
          ? [
              '-v',
              `${options.sharedHomeVolume}:/root`,
              '-e',
              `MACHINE_ID=${randomUUID().replace(/-/g, '')}`
            ]
          : []),
        '-e',
        `AUTHORIZED_KEY=${publicKey}`,
        getDockerSshHostImage(),
        'bash',
        '-lc',
        [
          ...(options.sharedHomeVolume ? ['printf "%s\\n" "$MACHINE_ID" > /etc/machine-id'] : []),
          // Appended on a shared home, so each container's key keeps working.
          `printf "%s\\n" "$AUTHORIZED_KEY" ${options.sharedHomeVolume ? '>>' : '>'} /root/.ssh/authorized_keys`,
          'chmod 600 /root/.ssh/authorized_keys',
          'git config --global user.email e2e@test.local',
          'git config --global user.name "Seal Docker SSH E2E"',
          'exec /usr/sbin/sshd -D -e'
        ].join(' && ')
      ],
      { timeoutMs: 120_000 }
    )

    const port = Number(
      runDockerSshHostProcess('docker', ['port', containerName, '22/tcp']).split(':').at(-1)
    )
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Unable to read mapped SSH port for ${containerName}`)
    }
    const containerIp = runDockerSshHostProcess('docker', [
      'inspect',
      '--format',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      containerName
    ])
    if (!containerIp) {
      throw new Error(`Unable to read container IP for ${containerName}`)
    }
    target = { containerName, containerIp, host, identityFile, port, tempDir }
    waitForSsh(target)
    seedRemoteRepo(target, DOCKER_SSH_HOST_REMOTE_REPO_PATH)
    return target
  } catch (error) {
    cleanupDockerSshHostTarget(
      target ?? { containerName, containerIp: '', host, identityFile, port: 0, tempDir }
    )
    throw error
  }
}

export function cleanupDockerSshHostTarget(target: DockerSshHostTarget | null): void {
  if (!target) {
    return
  }
  spawnDockerSshHostProcess('docker', ['rm', '-f', target.containerName], { timeoutMs: 20_000 })
  rmSync(target.tempDir, { recursive: true, force: true })
}
