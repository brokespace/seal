import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { HomeChatMachine, HomeChatMachineProvider } from '../machines/home-chat-machine-types'

export type TransferArgs = {
  fromMachine: string
  fromPath: string
  toMachine: string
  toPath: string
  recursive: boolean
  method: 'auto' | 'direct' | 'relay'
  signal?: AbortSignal
}

const TRANSFER_TIMEOUT_MS = 6 * 60 * 60_000

/** user@host:port of an SSH or hop machine, split for ssh/scp/rsync flags. */
export function parseMachineAddress(
  address: string | undefined
): { dest: string; port: string } | null {
  const match = address?.match(/^(.+):(\d+)$/)
  return match ? { dest: match[1], port: match[2] } : null
}

/** Run on the source: rsync when both ends have it, else scp; BatchMode fails fast without keys. */
export function directPushScript(
  fromPath: string,
  target: { dest: string; port: string },
  toPath: string,
  recursive: boolean
): string {
  const ssh = `ssh -o BatchMode=yes -o ConnectTimeout=20 -p ${target.port}`
  const remote = `${target.dest}:${toPath}`
  const src = quotePosixShell(fromPath)
  return [
    `if command -v rsync >/dev/null 2>&1 && ${ssh} ${quotePosixShell(target.dest)} 'command -v rsync' >/dev/null 2>&1; then`,
    `  rsync ${recursive ? '-a' : '-t'} --partial -e ${quotePosixShell(ssh)} -- ${src} ${quotePosixShell(remote)}`,
    'else',
    `  scp -q ${recursive ? '-r ' : ''}-o BatchMode=yes -o ConnectTimeout=20 -P ${target.port} -- ${src} ${quotePosixShell(remote)}`,
    'fi'
  ].join('\n')
}

async function relay(
  from: HomeChatMachine,
  to: HomeChatMachine,
  fromPath: string,
  toPath: string
): Promise<void> {
  if (from.info.kind === 'local') {
    await to.uploadFrom(fromPath, toPath)
    return
  }
  if (to.info.kind === 'local') {
    await from.downloadTo(fromPath, toPath)
    return
  }
  // Staged on disk, so large files never sit in memory.
  const staging = await mkdtemp(join(tmpdir(), 'seal-transfer-'))
  try {
    const staged = join(staging, basename(fromPath) || 'file')
    await from.downloadTo(fromPath, staged)
    await to.uploadFrom(staged, toPath)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function transferBetweenMachines(
  machines: HomeChatMachineProvider,
  args: TransferArgs
): Promise<{ text: string; label: string }> {
  const from = await machines.open(args.fromMachine)
  const to = await machines.open(args.toMachine)
  const label = `${from.info.label} → ${to.info.label}`
  const target = to.info.kind === 'local' ? null : parseMachineAddress(to.info.address)
  const canPush = from.info.kind !== 'local' && from.dialect === 'posix' && target !== null
  if (args.method === 'direct' && !canPush) {
    throw new Error(
      'A direct push needs a POSIX source machine and a destination with an SSH address.'
    )
  }
  let directError = ''
  if (canPush && target && args.method !== 'relay') {
    const result = await from.exec(
      directPushScript(args.fromPath, target, args.toPath, args.recursive),
      {
        timeoutMs: TRANSFER_TIMEOUT_MS,
        signal: args.signal
      }
    )
    if (result.exitCode === 0) {
      return { text: `Copied ${args.fromPath} to ${args.toPath} directly (${label}).`, label }
    }
    directError = (result.stderr || result.stdout).trim().slice(0, 500)
    if (args.method === 'direct') {
      throw new Error(`Direct copy failed: ${directError}`)
    }
  }
  if (args.recursive) {
    throw new Error(
      `Directories need a direct push${directError ? ` (which failed: ${directError})` : ''}. Archive it first (tar czf) and transfer the archive.`
    )
  }
  await relay(from, to, args.fromPath, args.toPath)
  const note = directError ? ' (direct push unavailable, relayed through this computer)' : ''
  return { text: `Copied ${args.fromPath} to ${args.toPath} (${label})${note}.`, label }
}
