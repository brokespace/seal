import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { HomeChatMachine } from './home-chat-machine-types'

function windowsAbsolute(path: string): boolean {
  return /^[A-Za-z]:/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

/**
 * File tools take paths the way a shell in the home folder would: `~` and relative paths start
 * there. Without this, each transport resolved them against a different folder, or not at all.
 */
export async function absoluteMachinePath(machine: HomeChatMachine, path: string): Promise<string> {
  const windows = machine.dialect === 'powershell'
  const underHome =
    path === '~'
      ? ''
      : path.startsWith('~/') || (windows && path.startsWith('~\\'))
        ? path.slice(2)
        : (windows ? windowsAbsolute(path) : path.startsWith('/'))
          ? null
          : path
  if (underHome === null) {
    return path
  }
  const home = (await machine.homeDir()).replace(/[\\/]+$/, '')
  return underHome ? `${home}${windows ? '\\' : '/'}${underHome}` : home || '/'
}

/** A path as one POSIX shell word; a leading `~` still means the home folder, as the model expects. */
export function posixPathWord(path: string): string {
  if (path === '~') {
    return '"$HOME"'
  }
  return path.startsWith('~/') ? `"$HOME"/${quotePosixShell(path.slice(2))}` : quotePosixShell(path)
}
