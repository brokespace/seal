import { app, shell } from 'electron'
import type { ShellOpenExternalEditorResult } from '../../shared/shell/opening/shell-open-types'
import { launchExternalEditor, type ExternalEditorLaunchSpec } from './external-editor-launch'

/** A GUI-launched app often lacks the editor's CLI shim on PATH; its registered link still opens it. */
export async function launchEditorOrProtocolUrl(
  launchSpec: ExternalEditorLaunchSpec,
  protocolUrl: string | null
): Promise<ShellOpenExternalEditorResult> {
  try {
    await launchExternalEditor(launchSpec)
    return { ok: true }
  } catch {
    try {
      if (protocolUrl && app.getApplicationNameForProtocol(protocolUrl)) {
        await shell.openExternal(protocolUrl)
        return { ok: true }
      }
    } catch {
      // Report the launcher failure below.
    }
    return { ok: false, reason: 'launch-failed' }
  }
}
