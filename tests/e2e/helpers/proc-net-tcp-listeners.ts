// A Linux host's TCP listeners and the process holding one, read from /proc so the host needs no extra tool.
import { quotePosixShell } from '../../../src/shared/shell/launch/shell-argument-quoting'

const IPV6_ANY = '0'.repeat(32)
const IPV6_LOOPBACK = `${'0'.repeat(24)}01000000`
const IPV4_MAPPED = `${'0'.repeat(16)}FFFF0000`

export type ListeningSocket = { address: string; port: number; loopback: boolean }

/** Runs a shell command on the host as root and returns its stdout. */
type RunOnHost = (command: string) => string

function socketAddress(hex: string): string {
  if (hex === IPV6_ANY || hex === IPV6_LOOPBACK) {
    return hex === IPV6_ANY ? '::' : '::1'
  }
  const ipv4 = hex.length === 8 ? hex : hex.startsWith(IPV4_MAPPED) ? hex.slice(24) : null
  // /proc/net/tcp prints an IPv4 address in host byte order.
  const bytes = (ipv4?.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16))
  return ipv4 ? bytes.toReversed().join('.') : hex
}

type Listener = ListeningSocket & { uid: string; inode: string }

function readListeners(runOnHost: RunOnHost): Listener[] {
  return runOnHost('cat /proc/net/tcp /proc/net/tcp6')
    .split('\n')
    .flatMap((line) => {
      const [, local = '', , state, , , , uid = '', , inode = ''] = line.trim().split(/\s+/)
      if (state !== '0A') {
        return []
      }
      const [hex = '', port = ''] = local.split(':')
      const address = socketAddress(hex)
      const loopback = address === '::1' || address.startsWith('127.')
      return [{ address, port: Number.parseInt(port, 16), loopback, uid, inode }]
    })
}

export function readListeningSockets(runOnHost: RunOnHost): ListeningSocket[] {
  return readListeners(runOnHost).map(({ address, port, loopback }) => ({
    address,
    port,
    loopback
  }))
}

/** The process listening on a loopback TCP port (the lowest PID when several share the socket), or null. */
export function readLoopbackListenerPid(runOnHost: RunOnHost, port: number): number | null {
  const socket = readListeners(runOnHost).find((entry) => entry.loopback && entry.port === port)
  if (!socket) {
    return null
  }
  // Root in a container cannot read another user's /proc/<pid>/fd, so the socket's owner looks.
  const holders = runOnHost(
    `setpriv --reuid=${socket.uid} --regid="$(id -g ${socket.uid})" --clear-groups ` +
      `find /proc/[0-9]*/fd -lname ${quotePosixShell(`socket:\\[${socket.inode}\\]`)} 2>/dev/null || true`
  )
  const pids = holders.split('\n').flatMap((holder) => {
    const pid = Number(holder.split('/')[2])
    return Number.isInteger(pid) ? [pid] : []
  })
  return pids.length > 0 ? Math.min(...pids) : null
}
