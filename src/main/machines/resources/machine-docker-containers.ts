import type {
  MachineDockerContainer,
  MachineDockerContainerAction,
  MachineDockerContainers
} from '../../../shared/machines/machine-resource-types'
import type { MachineConnection } from '../connection/machine-connection'
import { firstErrorLine, runMachineHostScript } from './machine-host-script'

const LIST_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 90_000
const CONTAINER_ID = /^[0-9a-f]{12,64}$/

const UNIT_BYTES: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4
}

/** Docker prints sizes as `12.2MB` (df) or `328KiB` (stats). */
export function parseDockerSize(text: string): number | null {
  const match = /^\s*([\d.]+)\s*([A-Za-z]+)/.exec(text)
  const unit = match ? UNIT_BYTES[match[2]] : undefined
  return match && unit ? Math.round(Number(match[1]) * unit) : null
}

function percent(text: string | undefined): number | null {
  const value = Number.parseFloat(text ?? '')
  return Number.isFinite(value) ? value : null
}

export const DOCKER_CONTAINERS_SCRIPT = `
command -v docker >/dev/null 2>&1 || { echo "@missing"; return 0; }
if ! listed=$(docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' 2>&1); then
  printf '@unreachable %s\\n' "$(printf '%s' "$listed" | head -n 1)"
  return 0
fi
echo "@ready"
printf '%s\\n' "$listed" | sed 's/^/@c\t/'
docker stats --no-stream --format '{{.ID}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}' 2>/dev/null | sed 's/^/@s\t/'
`

export function parseDockerContainers(output: string): MachineDockerContainers {
  const lines = output.split(/\r?\n/)
  if (lines.some((line) => line === '@missing')) {
    return { state: 'missing' }
  }
  const unreachable = lines.find((line) => line.startsWith('@unreachable'))
  if (unreachable || !lines.includes('@ready')) {
    return {
      state: 'unreachable',
      message: unreachable?.slice('@unreachable'.length).trim() || 'Docker did not answer.'
    }
  }
  const stats = new Map<string, string[]>()
  for (const line of lines) {
    if (line.startsWith('@s\t')) {
      const [id, ...rest] = line.split('\t').slice(1)
      stats.set(id, rest)
    }
  }
  const containers: MachineDockerContainer[] = []
  for (const line of lines) {
    if (!line.startsWith('@c\t')) {
      continue
    }
    const [id, name, image, status] = line.split('\t').slice(1)
    if (!id || !CONTAINER_ID.test(id)) {
      continue
    }
    const [usage, memPercent, cpuPercent] = stats.get(id) ?? []
    const [used, limit] = (usage ?? '').split('/')
    containers.push({
      id,
      name: name ?? id,
      image: image ?? '',
      status: status ?? '',
      running: /^Up\b/.test(status ?? ''),
      memUsageBytes: used ? parseDockerSize(used) : null,
      memLimitBytes: limit ? parseDockerSize(limit) : null,
      memPercent: percent(memPercent),
      cpuPercent: percent(cpuPercent)
    })
  }
  containers.sort((a, b) => (b.memUsageBytes ?? -1) - (a.memUsageBytes ?? -1))
  return { state: 'ready', containers }
}

export async function listMachineDockerContainers(
  connection: MachineConnection
): Promise<MachineDockerContainers> {
  const result = await runMachineHostScript(connection, DOCKER_CONTAINERS_SCRIPT, {
    timeoutMs: LIST_TIMEOUT_MS
  })
  return parseDockerContainers(result.stdout)
}

export async function runMachineDockerContainerAction(
  connection: MachineConnection,
  containerId: string,
  action: MachineDockerContainerAction
): Promise<void> {
  if (!CONTAINER_ID.test(containerId)) {
    throw new Error('Unknown container')
  }
  if (action !== 'stop' && action !== 'restart') {
    throw new Error('Unsupported container action')
  }
  const result = await runMachineHostScript(connection, `docker ${action} ${containerId}`, {
    timeoutMs: ACTION_TIMEOUT_MS
  })
  if (result.exitCode !== 0) {
    throw new Error(firstErrorLine(result))
  }
}
