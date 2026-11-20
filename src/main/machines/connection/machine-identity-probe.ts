import type { MachineIdentity } from '../../../shared/machines/machine-record'
import type { MachineShellDialect } from './machine-connection'

const MARKER = 'SEAL_IDENTITY'

const POSIX_IDENTITY_SCRIPT = [
  `printf '%s\\n' ${MARKER}`,
  '(hostname 2>/dev/null || uname -n 2>/dev/null) | head -n 1',
  'id=$(cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null)',
  `[ -n "$id" ] || id=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')`,
  `printf '%s\\n' "$id"`
].join('\n')

const POWERSHELL_IDENTITY_SCRIPT = [
  `Write-Output '${MARKER}'`,
  'Write-Output $env:COMPUTERNAME',
  "$key = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction SilentlyContinue",
  'Write-Output $key.MachineGuid'
].join('\n')

export function machineIdentityScript(dialect: MachineShellDialect): string {
  return dialect === 'powershell' ? POWERSHELL_IDENTITY_SCRIPT : POSIX_IDENTITY_SCRIPT
}

/** Login banners may precede the marker; the two lines after it are hostname and machine id. */
export function parseMachineIdentity(output: string): MachineIdentity {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const start = lines.lastIndexOf(MARKER)
  if (start === -1) {
    return { hostname: null, machineId: null }
  }
  return {
    hostname: lines[start + 1] || null,
    machineId: lines[start + 2] || null
  }
}
