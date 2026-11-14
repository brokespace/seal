import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

function macAppCliPaths(app: string, cli: string): string[] {
  const relative = posix.join(app, 'Contents/Resources/app/bin', cli)
  return [posix.join('/Applications', relative), posix.join(homedir(), 'Applications', relative)]
}

function listVsCodeCliInstallPaths(command: string, platform: NodeJS.Platform): string[] {
  if (command === 'cursor') {
    if (platform === 'darwin') {
      return macAppCliPaths('Cursor.app', 'cursor')
    }
    const { LOCALAPPDATA } = process.env
    return platform === 'win32' && LOCALAPPDATA
      ? [win32.join(LOCALAPPDATA, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')]
      : []
  }
  if (command !== 'code' && command !== 'code-insiders') {
    return []
  }
  const insiders = command === 'code-insiders'
  if (platform === 'darwin') {
    // The bundled macOS CLI is named `code` for both stable and Insiders.
    return macAppCliPaths(
      insiders ? 'Visual Studio Code - Insiders.app' : 'Visual Studio Code.app',
      'code'
    )
  }
  if (platform === 'win32') {
    const cli = win32.join(
      insiders ? 'Microsoft VS Code Insiders' : 'Microsoft VS Code',
      'bin',
      `${command}.cmd`
    )
    const { LOCALAPPDATA, ProgramFiles } = process.env
    return [
      ...(LOCALAPPDATA ? [win32.join(LOCALAPPDATA, 'Programs', cli)] : []),
      ...(ProgramFiles ? [win32.join(ProgramFiles, cli)] : [])
    ]
  }
  // Linux packages link /usr/bin or /snap/bin, which PATH resolution already covers.
  return []
}

/** The CLI bundled with VS Code or Cursor, for GUI launches whose PATH lacks the optional shim. */
export function findInstalledVsCodeCli(
  command: string,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean
): string | null {
  return listVsCodeCliInstallPaths(command, platform).find((path) => fileExists(path)) ?? null
}
