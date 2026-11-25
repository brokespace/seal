import { getRemoteSshEditorKind } from '../../shared/remote-ssh-editor-launcher'
import type { ShellOpenExternalEditorResult } from '../../shared/shell/opening/shell-open-types'
import type { SshTarget } from '../../shared/ssh-types'
import { loadUserSshConfig, type SshConfigHost } from '../ssh/config/ssh-config-parser'
import { resolveEditorProtocolUrl } from './editor-protocol-url'
import { getLauncherBaseName } from './editor-launcher-name'
import {
  resolveExternalEditorExecutable,
  type ExternalEditorLaunchSpec
} from './external-editor-launch'
import { resolveVsCodeSshAuthority } from '../ssh/external-editors/vscode-ssh-authority'
import { resolveZedSshUrl } from '../ssh/external-editors/zed-ssh-url'

export function resolveRemoteSshEditorLaunchSpec(
  command: string | undefined,
  pathValue: string,
  target: SshTarget,
  options: {
    platform?: NodeJS.Platform
    fileExists?: (path: string) => boolean
    loadSshConfigHosts?: () => readonly SshConfigHost[]
  } = {}
):
  | { ok: true; launchSpec: ExternalEditorLaunchSpec; protocolUrl: string | null }
  | Exclude<ShellOpenExternalEditorResult, { ok: true }> {
  const editorCommand = resolveExternalEditorExecutable(command, options)
  const editorKind = editorCommand ? getRemoteSshEditorKind(editorCommand) : null
  if (!editorCommand || !editorKind) {
    return { ok: false, reason: 'remote-editor-unsupported' }
  }
  let spawnArgs: string[]
  let protocolUrl: string | null = null
  if (editorKind === 'zed') {
    const zedUrl = resolveZedSshUrl(target, pathValue)
    if (!zedUrl.ok) {
      return zedUrl
    }
    spawnArgs = [zedUrl.url]
  } else {
    const authority = resolveVsCodeSshAuthority(
      target,
      options.loadSshConfigHosts ?? loadUserSshConfig
    )
    if (!authority.ok) {
      return authority
    }
    protocolUrl = resolveEditorProtocolUrl(editorCommand, pathValue, authority.authority)
    spawnArgs = ['--remote', `ssh-remote+${authority.authority}`, pathValue]
    // Cursor may reuse the last workbench; a new window preserves this workspace target.
    if (getLauncherBaseName(editorCommand) === 'cursor') {
      spawnArgs.unshift('--new-window')
    }
  }
  return {
    ok: true,
    launchSpec: {
      kind: 'executable',
      hideWindowsConsole: true,
      spawnCmd: editorCommand,
      spawnArgs
    },
    protocolUrl
  }
}
