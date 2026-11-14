import type { MachineMetrics, MachineOs } from '../../../shared/machines/machine-types'

/** One round-trip that works on Linux (procfs) and macOS (sysctl/vm_stat); every probe is best-effort. */
export const POSIX_MACHINE_METRICS_COMMAND = [
  'printf "hostname=%s\\n" "$(hostname 2>/dev/null)"',
  'printf "os=%s\\n" "$(uname -s 2>/dev/null)"',
  'printf "release=%s\\n" "$(uname -r 2>/dev/null)"',
  'printf "arch=%s\\n" "$(uname -m 2>/dev/null)"',
  'printf "home=%s\\n" "$HOME"',
  'if [ -r /proc/meminfo ]; then',
  '  awk \'/^MemTotal:/{print "memtotal_kb="$2} /^MemAvailable:/{print "memavail_kb="$2}\' /proc/meminfo',
  '  printf "cpus=%s\\n" "$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null)"',
  "  awk -F': ' '/^model name/{print \"cpumodel=\"$2; exit}' /proc/cpuinfo 2>/dev/null",
  '  printf "loadavg=%s\\n" "$(cut -d" " -f1-3 /proc/loadavg 2>/dev/null)"',
  '  printf "uptime=%s\\n" "$(cut -d" " -f1 /proc/uptime 2>/dev/null)"',
  '  [ -r /etc/os-release ] && awk -F= \'/^PRETTY_NAME=/{gsub(/"/,"",$2); print "pretty="$2}\' /etc/os-release',
  'else',
  '  printf "memtotal_b=%s\\n" "$(sysctl -n hw.memsize 2>/dev/null)"',
  '  vm_stat 2>/dev/null | awk \'/page size of/{ps=$8} /Pages free/{f=$3} /Pages inactive/{i=$3} /Pages speculative/{s=$3} END{if (ps) print "memavail_b="(f+i+s)*ps}\'',
  '  printf "cpus=%s\\n" "$(sysctl -n hw.ncpu 2>/dev/null)"',
  '  printf "cpumodel=%s\\n" "$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"',
  '  printf "loadavg=%s\\n" "$(sysctl -n vm.loadavg 2>/dev/null | tr -d "{}")"',
  '  printf "boottime=%s\\n" "$(sysctl -n kern.boottime 2>/dev/null | sed -n "s/.*sec = \\([0-9]*\\).*/\\1/p")"',
  '  printf "now=%s\\n" "$(date +%s)"',
  '  command -v sw_vers >/dev/null 2>&1 && printf "pretty=macOS %s\\n" "$(sw_vers -productVersion)"',
  'fi',
  'df -Pk "$HOME" 2>/dev/null | tail -n 1 | awk \'{print "disk="$2" "$4" "$6}\''
].join('\n')

function finiteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null
  }
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function osFromUname(value: string | undefined): MachineOs | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'linux') {
    return 'linux'
  }
  if (normalized === 'darwin') {
    return 'darwin'
  }
  if (normalized && /^(mingw|msys|cygwin)/.test(normalized)) {
    return 'win32'
  }
  return null
}

function parseLoadAverage(value: string | undefined): [number, number, number] | null {
  const parts = (value ?? '').trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) {
    return null
  }
  return [parts[0], parts[1], parts[2]]
}

function kibToBytes(value: string | undefined): number | null {
  const kib = finiteNumber(value)
  return kib === null ? null : kib * 1024
}

export function parsePosixMachineMetrics(output: string, collectedAt: number): MachineMetrics {
  const fields = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) {
      fields.set(line.slice(0, index).trim(), line.slice(index + 1))
    }
  }
  const [diskTotalKib, diskAvailKib, diskMount] = (fields.get('disk') ?? '').trim().split(/\s+/)
  const bootTime = finiteNumber(fields.get('boottime'))
  const now = finiteNumber(fields.get('now'))
  const procUptime = finiteNumber(fields.get('uptime'))
  return {
    hostname: nonEmpty(fields.get('hostname')),
    os: osFromUname(fields.get('os')),
    osRelease: nonEmpty(fields.get('pretty')) ?? nonEmpty(fields.get('release')),
    arch: nonEmpty(fields.get('arch')),
    cpuCount: finiteNumber(fields.get('cpus')),
    cpuModel: nonEmpty(fields.get('cpumodel')),
    loadAverage: parseLoadAverage(fields.get('loadavg')),
    cpuUsagePercent: null,
    memTotalBytes: kibToBytes(fields.get('memtotal_kb')) ?? finiteNumber(fields.get('memtotal_b')),
    memAvailableBytes:
      kibToBytes(fields.get('memavail_kb')) ?? finiteNumber(fields.get('memavail_b')),
    diskTotalBytes: kibToBytes(diskTotalKib),
    diskAvailableBytes: kibToBytes(diskAvailKib),
    diskMount: nonEmpty(diskMount),
    uptimeSeconds:
      procUptime !== null
        ? Math.floor(procUptime)
        : bootTime !== null && now !== null
          ? Math.max(0, now - bootTime)
          : null,
    homeDir: nonEmpty(fields.get('home')),
    collectedAt
  }
}
