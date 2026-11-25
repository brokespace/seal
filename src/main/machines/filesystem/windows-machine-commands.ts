import { quotePowerShellLiteral } from '../../../shared/powershell-native-argument'
import { normalizeWindowsDrivePath } from '../../ssh/filesystem/ssh-remote-directory-browse'
import { powerShellCommand } from '../../ssh/remote-exec/ssh-remote-powershell'
import { parseContentLength } from './posix-machine-commands'

const LENGTH_MARKER = 'SEAL_LENGTH '

// Windows PowerShell 5.1 defaults to TLS 1.0/1.1 and renders a slow progress bar unless silenced.
const WEB_REQUEST_PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12'
]

/** SFTP reports Windows paths as `/C:/Users/…`; PowerShell needs `C:/Users/…`. */
export function windowsPathFromSftp(sftpPath: string): string {
  return normalizeWindowsDrivePath(sftpPath)
}

export function windowsDownloadUrlCommand(url: string, sftpDestination: string): string {
  return powerShellCommand(
    [
      ...WEB_REQUEST_PRELUDE,
      `Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShellLiteral(url)} -OutFile ${quotePowerShellLiteral(windowsPathFromSftp(sftpDestination))}`
    ].join('\n')
  )
}

export function windowsUrlContentLengthCommand(url: string): string {
  return powerShellCommand(
    [
      ...WEB_REQUEST_PRELUDE,
      `$response = Invoke-WebRequest -UseBasicParsing -Method Head -Uri ${quotePowerShellLiteral(url)}`,
      `Write-Output ('${LENGTH_MARKER}' + (@($response.Headers['Content-Length']) -join ''))`
    ].join('\n')
  )
}

export function parseWindowsContentLength(output: string): number | null {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(LENGTH_MARKER))
  return line ? parseContentLength(line.slice(LENGTH_MARKER.length)) : null
}
