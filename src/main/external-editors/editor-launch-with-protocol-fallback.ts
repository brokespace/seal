import { app, shell } from 'electron'
import type { ShellOpenExternalEditorResult } from '../../shared/shell/opening/shell-open-types'
import {
  EXTERNAL_EDITOR_EARLY_EXIT_GRACE_MS,
  launchExternalEditor,
  type ExternalEditorLaunchSpec
} from './external-editor-launch'
import { ExternalEditorLaunchError } from './external-editor-launch-failure'

/** A GUI-launched app often lacks the editor's CLI shim on PATH; its registered link still opens it. */
export async function launchEditorOrProtocolUrl(
  launchSpec: ExternalEditorLaunchSpec,
  protocolUrl: string | null
): Promise<ShellOpenExternalEditorResult> {
  try {
    await launchExternalEditor(launchSpec, {
      earlyExitGraceMs: EXTERNAL_EDITOR_EARLY_EXIT_GRACE_MS
    })
    return { ok: true }
  } catch (error) {
    try {
      if (protocolUrl && app.getApplicationNameForProtocol(protocolUrl)) {
        await shell.openExternal(protocolUrl)
        return { ok: true }
      }
    } catch {
      // Report the launcher failure below.
    }
    console.warn('[shell] external editor launch failed:', error)
    return error instanceof ExternalEditorLaunchError
      ? { ok: false, reason: 'launch-failed', launchFailure: error.failure }
      : { ok: false, reason: 'launch-failed' }
  }
}
