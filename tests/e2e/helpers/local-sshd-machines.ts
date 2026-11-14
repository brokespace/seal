import { execFileSync, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

/** One real account on this machine, reached through a real sshd, with its own login shell. */
export type LocalSshdUser = {
  username: string
  loginShell: string
  home: string
  /** Runs as that user, outside Seal, so a test can seed and inspect what Seal should see. */
  sh: (script: string, stdin?: Buffer | string) => Buffer
}

export type LocalSshdMachines = {
  host: string
  port: number
  identityFile: string
  /** An ssh-agent holding the key, so the test's own user can log in to the accounts too. */
  agentSocket: string
  users: LocalSshdUser[]
  dispose: () => void
}

const PACKAGES: Record<string, string> = {
  '/usr/sbin/sshd': 'openssh-server',
  '/usr/bin/zsh': 'zsh',
  '/usr/bin/fish': 'fish',
  '/usr/bin/rsync': 'rsync'
}

function sudo(args: string[], input?: Buffer | string): Buffer {
  return execFileSync('sudo', ['-n', ...args], {
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024
  })
}

/** Why a real sshd cannot run here, or null when it can. */
export function localSshdUnavailableReason(): string | null {
  if (process.platform !== 'linux') {
    return 'the sshd fixture creates Linux accounts'
  }
  if (spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status !== 0) {
    return 'passwordless sudo is needed to create accounts and run sshd'
  }
  return null
}

function installMissingPackages(): void {
  const missing = Object.entries(PACKAGES)
    .filter(([file]) => !existsSync(file))
    .map(([, name]) => name)
  if (missing.length === 0) {
    return
  }
  const env = ['env', 'DEBIAN_FRONTEND=noninteractive']
  try {
    sudo([...env, 'apt-get', 'install', '-y', '--no-install-recommends', ...missing])
  } catch {
    sudo([...env, 'apt-get', 'update'])
    sudo([...env, 'apt-get', 'install', '-y', '--no-install-recommends', ...missing])
  }
}

function removeUser(username: string): void {
  spawnSync('sudo', ['-n', 'pkill', '-KILL', '-u', username], { stdio: 'ignore' })
  spawnSync('sudo', ['-n', 'userdel', '-r', '-f', username], { stdio: 'ignore' })
}

async function freeLoopbackPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/** ssh reads known_hosts from the account's real home, whatever HOME says. */
function trustHostKeyForThisUser(knownHost: string, port: number): () => void {
  const sshDir = path.join(os.userInfo().homedir, '.ssh')
  const file = path.join(sshDir, 'known_hosts')
  mkdirSync(sshDir, { recursive: true, mode: 0o700 })
  appendFileSync(file, knownHost, { mode: 0o600 })
  return () => {
    spawnSync('ssh-keygen', ['-R', `[127.0.0.1]:${port}`, '-f', file], { stdio: 'ignore' })
    rmSync(`${file}.old`, { force: true })
  }
}

function startAgent(socket: string, identityFile: string): () => void {
  const started = execFileSync('ssh-agent', ['-a', socket], { encoding: 'utf8' })
  const pid = /SSH_AGENT_PID=(\d+)/.exec(started)?.[1]
  execFileSync('ssh-add', ['-q', identityFile], { env: { ...process.env, SSH_AUTH_SOCK: socket } })
  return () => {
    if (pid) {
      spawnSync('kill', [pid], { stdio: 'ignore' })
    }
  }
}

/**
 * Starts sshd on a loopback port with one fresh account per login shell. Every account trusts the
 * returned key, and each can also log in to the others, as machines on one network often can.
 */
export async function startLocalSshdMachines(
  accounts: readonly { username: string; loginShell: string }[]
): Promise<LocalSshdMachines> {
  installMissingPackages()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-sshd-'))
  const port = await freeLoopbackPort()
  const identityFile = path.join(dir, 'client_key')
  const hostKey = path.join(dir, 'host_key')
  const pidFile = path.join(dir, 'sshd.pid')
  for (const key of [identityFile, hostKey]) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
  }
  const publicKey = readFileSync(`${identityFile}.pub`, 'utf8')
  const knownHost = `[127.0.0.1]:${port} ${readFileSync(`${hostKey}.pub`, 'utf8')}`

  const users = accounts.map(({ username, loginShell }): LocalSshdUser => {
    removeUser(username)
    sudo(['useradd', '-m', '-s', loginShell, username])
    // useradd locks the password, and sshd without PAM refuses a locked account.
    sudo(['usermod', '-p', '*', username])
    const home = `/home/${username}`
    const sh = (script: string, stdin?: Buffer | string): Buffer =>
      sudo(['-H', '-u', username, '/bin/sh', '-c', script], stdin ?? '')
    sh('umask 077; mkdir -p ~/.ssh; cat > ~/.ssh/authorized_keys', publicKey)
    sh('umask 077; cat > ~/.ssh/id_ed25519', readFileSync(identityFile))
    sh('cat > ~/.ssh/known_hosts', knownHost)
    return { username, loginShell, home, sh }
  })

  writeFileSync(
    path.join(dir, 'sshd_config'),
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${hostKey}`,
      `PidFile ${pidFile}`,
      'AuthorizedKeysFile .ssh/authorized_keys',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'UsePAM no',
      `AllowUsers ${accounts.map((account) => account.username).join(' ')}`,
      'Subsystem sftp internal-sftp',
      'MaxSessions 64',
      'MaxStartups 64:30:128',
      ''
    ].join('\n')
  )
  sudo(['mkdir', '-p', '/run/sshd'])
  sudo(['chown', 'root:root', hostKey])
  sudo(['/usr/sbin/sshd', '-f', path.join(dir, 'sshd_config'), '-E', path.join(dir, 'sshd.log')])

  const agentSocket = path.join(dir, 'agent.sock')
  const stopAgent = startAgent(agentSocket, identityFile)
  const forgetHostKey = trustHostKeyForThisUser(knownHost, port)

  return {
    host: '127.0.0.1',
    port,
    identityFile,
    agentSocket,
    users,
    dispose: () => {
      stopAgent()
      forgetHostKey()
      spawnSync('sudo', ['-n', 'pkill', '-F', pidFile], { stdio: 'ignore' })
      for (const { username } of accounts) {
        removeUser(username)
      }
      spawnSync('sudo', ['-n', 'rm', '-rf', dir], { stdio: 'ignore' })
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
