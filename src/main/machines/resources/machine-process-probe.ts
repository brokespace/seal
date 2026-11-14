import type {
  MachineProcess,
  MachineProcessSnapshot,
  MachineSwapUsage,
  MachineTmuxPaneUsage
} from '../../../shared/machines/machine-resource-types'
import { processProvider } from '../../live-sessions/discovery/agent-processes'
import type { MachineConnection } from '../connection/machine-connection'
import { maskCommandLineSecrets } from './command-line-secrets'
import { runMachineHostScript } from './machine-host-script'

const PROBE_TIMEOUT_MS = 30_000
/** Per ranking (CPU, memory); the host sends only these so a busy machine stays one small reply. */
const TOP_PROCESSES = 40
const COMMAND_MAX_CHARS = 600
// A header wider than any login name keeps `ps` from truncating the user column.
const USER_HEADER = 'U'.repeat(32)

const SELECT_TOP_AWK = String.raw`
$1 == "@second" { second = 1; next }
$1 == "@clk" { clk = $2; next }
$1 == "@t" { if (second) { t2[$2] = $3; st[$2] = $4 } else t1[$2] = $3; next }
$1 == "@up" { if (second) up2 = $2; else up1 = $2; next }
$1 == "@stat" {
  total = 0; for (i = 3; i <= 10; i++) total += $i
  idle = $6 + $7
  if (second) { tot2 = total; idle2 = idle } else { tot1 = total; idle1 = idle }
  next
}
$1 == "@n" { pid = $2; sub(/^@n +[0-9]+ /, ""); gsub(/\t/, " "); name[pid] = $0; next }
$1 == "@tmux" { pid = $2; sub(/^@tmux +[0-9]+ /, ""); gsub(/\t/, " "); pane[pid] = $0; next }
$1 == "@ps" { inps = 1; next }
inps && $1 ~ /^[0-9]+$/ {
  pid = $1; ppid[pid] = $2; cpu = $3 + 0
  if (second && up2 > up1 && clk > 0 && (pid in t2)) {
    before = (pid in t1) ? t1[pid] : 0
    cpu = (t2[pid] - before) / clk / (up2 - up1) * 100
    if (cpu < 0) cpu = 0
  }
  cpuv[pid] = cpu; rssv[pid] = $5 + 0
  gsub(/\t/, " "); line[pid] = substr($0, 1, ${COMMAND_MAX_CHARS + 120})
  order[++n] = pid
}
END {
  p = self; guard = 0
  while ((p in ppid) && p > 1 && guard++ < 64) { chain[p] = 1; p = ppid[p] }
  for (k = 0; k < top; k++) {
    best = ""
    for (i = 1; i <= n; i++) { q = order[i]; if (!(q in bycpu) && (best == "" || cpuv[q] > cpuv[best])) best = q }
    if (best == "") break
    bycpu[best] = 1; pick[best] = 1
  }
  for (k = 0; k < top; k++) {
    best = ""
    for (i = 1; i <= n; i++) { q = order[i]; if (!(q in bymem) && (best == "" || rssv[q] > rssv[best])) best = q }
    if (best == "") break
    bymem[best] = 1; pick[best] = 1
  }
  for (i = 1; i <= n; i++) {
    pid = order[i]
    q = pid; guard = 0; tm = ""
    while ((q in ppid) && q > 1 && guard++ < 64) { if (q in pane) { tm = pane[q]; break } q = ppid[q] }
    if (tm != "") { panecpu[tm] += cpuv[pid]; panerss[tm] += rssv[pid]; panen[tm]++ }
    # Agents and pane shells are listed however idle they are, so sessions map to a process.
    if (!(pid in pick) && !(pid in pane) && line[pid] !~ /claude|codex/) continue
    printf "@p\t%s\t%.1f\t%s\t%s\t%s\t%s\t%s\n", pid, cpuv[pid], ((pid in st) ? "t" st[pid] : ""), ((pid in chain) ? 1 : 0), name[pid], tm, line[pid]
  }
  for (pid in pane) if (pane[pid] in panen) printf "@pane\t%s\t%s\t%.1f\t%d\t%d\n", pane[pid], pid, panecpu[pane[pid]], panerss[pane[pid]], panen[pane[pid]]
  print "@total " n
  if (tot2 > tot1) printf "@busy %.1f\n", (1 - (idle2 - idle1) / (tot2 - tot1)) * 100
}`

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** One sample over one second on Linux (procfs deltas); elsewhere `ps` already reports recent CPU. */
export const MACHINE_PROCESS_PROBE_SCRIPT = `
if [ -r /proc/meminfo ]; then
  awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{print "@swapkb", t+0, f+0}' /proc/meminfo
else
  echo "@swapmac $(sysctl -n vm.swapusage 2>/dev/null)"
fi
{
  if [ -r /proc/uptime ] && [ -r /proc/stat ]; then
    echo "@clk $(getconf CLK_TCK 2>/dev/null || echo 100)"
    snap() {
      echo "@up $(cut -d' ' -f1 /proc/uptime)"
      echo "@stat $(head -n 1 /proc/stat)"
      cat /proc/[0-9]*/stat 2>/dev/null | awk '{ s = $0; i = 0; while ((j = index(substr(s, i + 1), ")")) > 0) i += j; split(substr(s, i + 2), f, " "); print "@t", $1, f[12] + f[13], f[20] }'
    }
    snap
    sleep 1
    echo "@second"
    snap
  fi
  ps -A -o pid= -o comm= 2>/dev/null | sed 's/^ */@n /'
  if command -v tmux >/dev/null 2>&1; then
    tmux list-panes -a -F '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}' 2>/dev/null | sed 's/^/@tmux /'
  fi
  echo "@ps"
  ps -A -o pid= -o ppid= -o pcpu= -o pmem= -o rss= -o user=${USER_HEADER} -o lstart= -o args= 2>/dev/null
} | awk -v self="$$" -v top=${TOP_PROCESSES} ${shQuote(SELECT_TOP_AWK)}
`

const PS_LINE =
  /^\s*(\d+)\s+(\d+)\s+[\d.]+\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/

function parseMacSwap(raw: string): MachineSwapUsage | null {
  const bytes = (label: string): number | null => {
    const match = new RegExp(`${label} = ([\\d.]+)([KMGT])`).exec(raw)
    if (!match) {
      return null
    }
    return Number(match[1]) * 1024 ** ('KMGT'.indexOf(match[2]) + 1)
  }
  const total = bytes('total')
  const used = bytes('used')
  return total === null || used === null ? null : { totalBytes: total, usedBytes: used }
}

function baseName(command: string): string {
  const trimmed = command.trim()
  return trimmed.startsWith('/') ? (trimmed.split('/').pop() ?? trimmed) : trimmed
}

function parseProcess(fields: string[]): MachineProcess | null {
  const [pid, cpu, startTicks, inChain, name, tmux, psLine] = fields
  const match = PS_LINE.exec(psLine ?? '')
  if (!match) {
    return null
  }
  const args = match[7].trim()
  return {
    pid: Number(pid),
    ppid: Number(match[2]),
    user: match[5],
    name: baseName(name || args.split(' ')[0] || ''),
    command: maskCommandLineSecrets(args).slice(0, COMMAND_MAX_CHARS),
    cpuPercent: Number(cpu) || 0,
    memPercent: Number(match[3]) || 0,
    rssBytes: Number(match[4]) * 1024,
    startMarker: startTicks || match[6].split(/\s+/).join(' '),
    tmuxPane: tmux || null,
    agent: processProvider(args),
    carriesSealConnection: inChain === '1'
  }
}

export function parseMachineProcessProbe(
  output: string,
  collectedAt: number
): MachineProcessSnapshot {
  const processes: MachineProcess[] = []
  const tmuxPanes: MachineTmuxPaneUsage[] = []
  let totalProcesses = 0
  let cpuBusyPercent: number | null = null
  let swap: MachineSwapUsage | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('@p\t')) {
      const parsed = parseProcess(line.split('\t').slice(1))
      if (parsed) {
        processes.push(parsed)
      }
    } else if (line.startsWith('@pane\t')) {
      const [pane, pid, cpu, rssKb, count] = line.split('\t').slice(1)
      tmuxPanes.push({
        pane,
        pid: Number(pid),
        cpuPercent: Number(cpu) || 0,
        rssBytes: (Number(rssKb) || 0) * 1024,
        processCount: Number(count) || 0
      })
    } else if (line.startsWith('@total ')) {
      totalProcesses = Number(line.slice('@total '.length)) || 0
    } else if (line.startsWith('@busy ')) {
      const busy = Number(line.slice('@busy '.length))
      cpuBusyPercent = Number.isFinite(busy) ? Math.min(100, Math.max(0, busy)) : null
    } else if (line.startsWith('@swapkb ')) {
      const [total, free] = line.slice('@swapkb '.length).split(' ').map(Number)
      swap = { totalBytes: total * 1024, usedBytes: Math.max(0, total - free) * 1024 }
    } else if (line.startsWith('@swapmac ')) {
      swap = parseMacSwap(line)
    }
  }
  tmuxPanes.sort((a, b) => a.pane.localeCompare(b.pane))
  return { processes, tmuxPanes, totalProcesses, cpuBusyPercent, swap, collectedAt }
}

export async function probeMachineProcesses(
  connection: MachineConnection
): Promise<MachineProcessSnapshot> {
  const result = await runMachineHostScript(connection, MACHINE_PROCESS_PROBE_SCRIPT, {
    timeoutMs: PROBE_TIMEOUT_MS
  })
  const snapshot = parseMachineProcessProbe(result.stdout, Date.now())
  if (snapshot.totalProcesses === 0) {
    throw new Error(result.stderr.trim().split(/\r?\n/)[0] || 'The machine listed no processes.')
  }
  return snapshot
}
