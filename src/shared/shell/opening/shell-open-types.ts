import type { ExecutionHostId } from '../../execution-host'
import type { BuiltInEditorId } from '../../open-in-applications'

export type ShellOpenExternalEditorRequest = {
  path: string
  /** Id of a persisted Open In application; main launches its saved command. */
  openInApplicationId?: string
  builtInEditorId?: BuiltInEditorId
  /** Legacy callers only; main accepts it solely when it equals a saved or built-in command. */
  command?: string
  connectionId?: string | null
  /** Host that owns `path`; main refuses unless it is `local`, a WSL host (Windows), or, with `connectionId`, that SSH host or a server running on it. */
  ownerHostId: ExecutionHostId
}

export type ShellOpenPathFailureReason =
  | 'not-absolute'
  | 'not-found'
  | 'launch-failed'
  | 'remote-runtime-unsupported'
  | 'ssh-target-not-found'
  | 'ssh-target-invalid'
  | 'ssh-alias-required'
  | 'remote-editor-unsupported'

export type ShellOpenLocalPathFailureReason = Extract<
  ShellOpenPathFailureReason,
  'not-absolute' | 'not-found' | 'launch-failed' | 'remote-runtime-unsupported'
>

export type ShellOpenLocalPathResult =
  | { ok: true }
  | { ok: false; reason: ShellOpenLocalPathFailureReason }

/** Why the editor's launcher did not start, or quit at once; `command` is what Seal ran. */
export type ShellEditorLaunchFailure =
  | { kind: 'not-found' | 'not-executable'; command: string }
  | { kind: 'exited'; command: string; exitCode: number }
  | { kind: 'error'; command: string; message: string }

export type ShellOpenExternalEditorResult =
  | { ok: true }
  | {
      ok: false
      reason: Exclude<ShellOpenPathFailureReason, 'ssh-alias-required'>
      /** Present on `launch-failed` when the launcher itself reported the failure. */
      launchFailure?: ShellEditorLaunchFailure
    }
  | { ok: false; reason: 'ssh-alias-required'; host: string; port: number }

/**
 * Outcome of opening a linked local file. `open-in-editor`: main did not hand the file to the OS
 * because it is a script or launcher that is readable text; the caller shows it in Orca instead.
 */
export type ShellOpenFileResult = 'opened' | 'revealed' | 'open-in-editor' | 'failed'
