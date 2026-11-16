// What lets systemd boot as PID 1 of a Docker container, and the wait for that boot to end.
import { spawnDockerSshHostProcess } from './docker-ssh-host-target'

const BOOT_TIMEOUT_MS = 60_000

// --privileged also boots systemd, but lets it write its sysctls into the host kernel.
export function systemdCgroupFlags(dockerMajor: number): string[] {
  return dockerMajor >= 28
    ? ['--security-opt', 'writable-cgroups=true']
    : ['--cgroupns=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw']
}

function bootDiagnostics(containerName: string): string {
  const state = spawnDockerSshHostProcess('docker', [
    'inspect',
    '-f',
    '{{.State.Status}} {{.State.ExitCode}}',
    containerName
  ])
  const failed = spawnDockerSshHostProcess('docker', [
    'exec',
    containerName,
    'systemctl',
    '--failed',
    '--no-legend'
  ])
  const logs = spawnDockerSshHostProcess('docker', ['logs', '--tail', '200', containerName])
  return [
    `container: ${state.stdout || state.stderr}`,
    `failed units: ${failed.stdout || failed.stderr || 'none'}`,
    `docker logs: ${[logs.stdout, logs.stderr].filter(Boolean).join('\n') || '(empty)'}`
  ].join('\n')
}

export function waitForSystemRunning(containerName: string): void {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  const isSystemRunning = ['exec', containerName, 'systemctl', 'is-system-running', '--wait']
  let boot = spawnDockerSshHostProcess('docker', isSystemRunning, { timeoutMs: BOOT_TIMEOUT_MS })
  // --wait blocks until the boot ends, so this loops only while systemd's bus is not up yet ("offline").
  const busIsDown = (): boolean => boot.stdout === '' || boot.stdout === 'offline'
  while (busIsDown() && !/is not running/.test(boot.stderr) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    boot = spawnDockerSshHostProcess('docker', isSystemRunning, {
      timeoutMs: Math.max(1_000, deadline - Date.now())
    })
  }
  if (boot.stdout !== 'running') {
    throw new Error(
      `systemd in ${containerName} did not reach "running": ${boot.stdout || boot.stderr}\n${bootDiagnostics(containerName)}`
    )
  }
}
