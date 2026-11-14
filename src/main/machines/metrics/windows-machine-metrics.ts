import type { MachineMetrics } from '../../../shared/machines/machine-types'
import { powerShellCommand } from '../../ssh/remote-exec/ssh-remote-powershell'

const METRICS_MARKER = 'SEAL_METRICS '

// `$home` is a read-only automatic variable, hence `$userHome`; CIM classes exist on every PowerShell 3+ host.
const WINDOWS_MACHINE_METRICS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$os = Get-CimInstance Win32_OperatingSystem',
  '$cpus = @(Get-CimInstance Win32_Processor)',
  '$cpuModel = $null',
  'if ($cpus.Count -gt 0) { $cpuModel = $cpus[0].Name }',
  '$cpuPercent = ($cpus | Measure-Object -Property LoadPercentage -Average).Average',
  "$userHome = [Environment]::GetFolderPath('UserProfile')",
  '$drive = $userHome.Substring(0, 2)',
  `$disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $drive + "'")`,
  '$uptime = $null',
  'if ($os.LastBootUpTime) { $uptime = [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds }',
  '$out = [ordered]@{',
  '  hostname = $env:COMPUTERNAME; caption = $os.Caption; version = $os.Version',
  '  arch = $env:PROCESSOR_ARCHITECTURE; cpus = [Environment]::ProcessorCount',
  '  cpuModel = $cpuModel; cpuPercent = $cpuPercent',
  '  memTotalKb = $os.TotalVisibleMemorySize; memFreeKb = $os.FreePhysicalMemory',
  '  diskTotal = $disk.Size; diskFree = $disk.FreeSpace; diskMount = $drive',
  '  uptime = $uptime; home = $userHome',
  '}',
  `Write-Output ('${METRICS_MARKER}' + ($out | ConvertTo-Json -Compress))`
].join('\n')

export const WINDOWS_MACHINE_METRICS_COMMAND = powerShellCommand(WINDOWS_MACHINE_METRICS_SCRIPT)

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

const ARCH_NAMES: Record<string, string> = { AMD64: 'x86_64', ARM64: 'arm64', X86: 'x86' }

/** Reads the marked JSON line, ignoring any banner or profile noise around it. */
export function parseWindowsMachineMetrics(output: string, collectedAt: number): MachineMetrics {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(METRICS_MARKER))
  let fields: Fields = {}
  if (line) {
    try {
      const parsed: unknown = JSON.parse(line.slice(METRICS_MARKER.length))
      fields = isFields(parsed) ? parsed : {}
    } catch {
      fields = {}
    }
  }
  const kib = (value: unknown): number | null => {
    const parsed = finite(value)
    return parsed === null ? null : parsed * 1024
  }
  const arch = text(fields.arch)
  const caption = text(fields.caption)?.replace(/^Microsoft\s+Windows\s*/i, '') || null
  return {
    hostname: text(fields.hostname),
    os: 'win32',
    osRelease: caption ?? text(fields.version),
    arch: arch ? (ARCH_NAMES[arch.toUpperCase()] ?? arch) : null,
    cpuCount: finite(fields.cpus),
    cpuModel: text(fields.cpuModel),
    loadAverage: null,
    cpuUsagePercent: finite(fields.cpuPercent),
    memTotalBytes: kib(fields.memTotalKb),
    memAvailableBytes: kib(fields.memFreeKb),
    diskTotalBytes: finite(fields.diskTotal),
    diskAvailableBytes: finite(fields.diskFree),
    diskMount: text(fields.diskMount),
    uptimeSeconds: finite(fields.uptime),
    homeDir: text(fields.home),
    collectedAt
  }
}
