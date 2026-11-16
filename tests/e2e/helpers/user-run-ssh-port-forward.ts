// The `ssh -N -L` a user runs by hand to reach a server on a host's loopback. Seal neither starts nor owns it.
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { expect } from './orca-app'
import type { DockerSystemdSshHost } from './docker-ssh-host-systemd-target'

export type UserRunSshPortForward = {
  running: () => boolean
  stop: () => void
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Forwards 127.0.0.1:<port> on this computer to the same port on the host's loopback, which is where a
 * pairing link of a loopback server points. Throws when the port is taken here.
 */
export async function startUserRunSshPortForward(
  ssh: DockerSystemdSshHost['ssh'],
  port: number
): Promise<UserRunSshPortForward> {
  if (await accepts(port)) {
    throw new Error(`Port ${port} on this computer is taken, so no SSH tunnel can listen on it`)
  }
  const forward = spawn(
    'ssh',
    [
      '-N',
      '-L',
      `127.0.0.1:${port}:127.0.0.1:${port}`,
      '-i',
      ssh.identityFile,
      '-p',
      String(ssh.port),
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      `${ssh.username}@${ssh.host}`
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let said = ''
  forward.stderr.on('data', (chunk: Buffer) => {
    said += chunk.toString()
  })
  const running = (): boolean => forward.exitCode === null && forward.signalCode === null
  const exited = new Promise<never>((_resolve, reject) => {
    forward.once('error', reject)
    forward.once('exit', () => reject(new Error(`ssh -L ${port} exited: ${said.trim()}`)))
  })
  // stop() ends the process long after the race below is over.
  exited.catch(() => {})
  try {
    await Promise.race([expect.poll(() => accepts(port), { timeout: 30_000 }).toBe(true), exited])
  } catch (error) {
    forward.kill()
    throw error
  }
  return { running, stop: () => void forward.kill() }
}
