import type { ShellEditorLaunchFailure } from '../../shared/shell/opening/shell-open-types'

export class ExternalEditorLaunchError extends Error {
  constructor(readonly failure: ShellEditorLaunchFailure) {
    super(`Editor launch failed (${failure.kind}): ${failure.command}`)
    this.name = 'ExternalEditorLaunchError'
  }
}

export function describeEditorSpawnFailure(
  error: Error,
  command: string
): ShellEditorLaunchFailure {
  const code = 'code' in error ? error.code : undefined
  if (code === 'ENOENT') {
    return { kind: 'not-found', command }
  }
  if (code === 'EACCES') {
    return { kind: 'not-executable', command }
  }
  return { kind: 'error', command, message: error.message }
}

export function describeEditorExitFailure(
  exitCode: number,
  command: string,
  ranThroughPosixShell: boolean
): ShellEditorLaunchFailure {
  // POSIX shells report a missing or unrunnable command through these exit codes.
  if (ranThroughPosixShell && exitCode === 127) {
    return { kind: 'not-found', command }
  }
  if (ranThroughPosixShell && exitCode === 126) {
    return { kind: 'not-executable', command }
  }
  return { kind: 'exited', command, exitCode }
}
