import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { wrapRemoteCommandForPosixShell } from '../../ssh/remote-exec/ssh-posix-command-wrapper'
import { absoluteMachinePath } from '../machines/home-chat-machine-paths'
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

const posixParent = (path: string): string => path.replace(/\/+[^/]*\/*$/, '') || '/'

/**
 * Run on the source: rsync when both ends have it, else a plain stream over ssh. BatchMode fails
 * fast without keys. A copied directory lands at `toPath` itself, whichever tool carries it.
 */
export function directPushScript(
  fromPath: string,
  target: { dest: string; port: string },
  toPath: string,
  recursive: boolean
): string {
  const ssh = `ssh -o BatchMode=yes -o ConnectTimeout=20 -p ${target.port}`
  const src = quotePosixShell(fromPath)
  // Wrapped for /bin/sh, so the far account's login shell (zsh, fish) never parses the path.
  const onTarget = (script: string): string =>
    `${ssh} ${quotePosixShell(target.dest)} ${quotePosixShell(wrapRemoteCommandForPosixShell(script))}`
  const rsync = (flags: string, from: string, to: string): string =>
    `rsync ${flags} --partial -e ${quotePosixShell(ssh)} -- ${quotePosixShell(from)} ${quotePosixShell(`${target.dest}:${to}`)} 2>/dev/null`
  const [kind, folder, viaRsync, viaStream] = recursive
    ? [
        'd',
        toPath,
        rsync('-a', `${fromPath}/`, `${toPath}/`),
        `tar -C ${src} -cf - . | ${onTarget(`tar -C ${quotePosixShell(toPath)} -xf -`)}`
      ]
    : [
        'f',
        posixParent(toPath),
        rsync('-t', fromPath, toPath),
        `${onTarget(`cat > ${quotePosixShell(toPath)}`)} < ${src}`
      ]
  return [
    `if [ ! -${kind} ${src} ]; then printf '%s is not a ${recursive ? 'directory' : 'file; set recursive to copy a directory'}\n' ${src} >&2; exit 1; fi`,
    `${onTarget(`mkdir -p -- ${quotePosixShell(folder)}`)} || exit 1`,
    // Older rsync cannot carry a path with spaces; the stream below can.
    `if command -v rsync >/dev/null 2>&1 && ${onTarget('command -v rsync')} >/dev/null 2>&1 && ${viaRsync}; then exit 0; fi`,
    viaStream
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
  const fromPath = await absoluteMachinePath(from, args.fromPath)
  const toPath = await absoluteMachinePath(to, args.toPath)
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
    const result = await from.exec(directPushScript(fromPath, target, toPath, args.recursive), {
      timeoutMs: TRANSFER_TIMEOUT_MS,
      signal: args.signal
    })
    if (result.exitCode === 0) {
      return { text: `Copied ${fromPath} to ${toPath} directly (${label}).`, label }
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
  await relay(from, to, fromPath, toPath)
  const note = directError ? ' (direct push unavailable, relayed through this computer)' : ''
  return { text: `Copied ${fromPath} to ${toPath} (${label})${note}.`, label }
}
