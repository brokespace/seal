import { posix, win32 } from 'node:path'
import { getLauncherBaseName } from './editor-launcher-name'

const EDITOR_URL_SCHEMES: Record<string, string> = {
  code: 'vscode',
  'code-insiders': 'vscode-insiders',
  'code - insiders': 'vscode-insiders',
  cursor: 'cursor'
}

function toUrlPath(pathValue: string): string | null {
  if (posix.isAbsolute(pathValue)) {
    return pathValue
  }
  // UNC shares have no single-slash URL form these editors accept.
  return win32.isAbsolute(pathValue) && /^[a-z]:/i.test(pathValue)
    ? `/${pathValue.replaceAll('\\', '/')}`
    : null
}

/**
 * The link the OS hands to an installed VS Code or Cursor, for launches whose CLI shim is missing:
 * `vscode://vscode-remote/ssh-remote+<authority><path>`, or `vscode://file<path>` for a local path.
 */
export function resolveEditorProtocolUrl(
  editorCommand: string,
  pathValue: string,
  sshAuthority?: string
): string | null {
  const scheme = EDITOR_URL_SCHEMES[getLauncherBaseName(editorCommand)]
  const urlPath = toUrlPath(pathValue)
  if (!scheme || !urlPath || sshAuthority?.includes('/')) {
    return null
  }
  const location =
    sshAuthority === undefined
      ? `file${urlPath}`
      : `vscode-remote/ssh-remote+${sshAuthority}${urlPath}`
  return `${scheme}://${encodeURI(location).replace(/[?#]/g, encodeURIComponent)}`
}
