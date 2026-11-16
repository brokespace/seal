import {
  MACHINE_DOCKER_CONTAINER_ACTIONS,
  type MachineDockerContainer,
  type MachineDockerContainerAction,
  type MachineDockerContainers
} from '../../../shared/machines/machine-resource-types'
import type { MachineConnection } from '../connection/machine-connection'
import { forgetDockerInventory } from './machine-docker-inventory'
import {
  DOCKER_CONTAINER_ID,
  DOCKER_TRY_FUNCTION,
  dockerJsonRows,
  dockerText,
  parseDockerSizePair,
  parseDockerUnavailable
} from './machine-docker-output'
import { firstErrorLine, runMachineHostScript } from './machine-host-script'

const LIST_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 90_000

function figure(text: unknown): number | null {
  const value = Number.parseFloat(dockerText(text))
  return Number.isFinite(value) ? value : null
}

/** Defines `seal_docker_list`, which fails when Docker is missing or does not answer. */
export const DOCKER_CONTAINER_LIST_FUNCTION = `
${DOCKER_TRY_FUNCTION}
seal_docker_list() {
  seal_docker_try docker ps -a --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' || return 1
  printf '%s\\n' "$seal_docker_out" | sed 's/^/@c\t/'
}
`

const DOCKER_CONTAINERS_SCRIPT = `
${DOCKER_CONTAINER_LIST_FUNCTION}
seal_docker_list || return 0
docker stats --no-stream --no-trunc --format '{{json .}}' 2>/dev/null | sed 's/^/@s /'
`

export function parseDockerContainers(output: string): MachineDockerContainers {
  const lines = output.split(/\r?\n/)
  const unavailable = parseDockerUnavailable(lines)
  if (unavailable) {
    return unavailable
  }
  const stats = new Map(dockerJsonRows(lines, '@s ').map((row) => [dockerText(row.ID), row]))
  const containers: MachineDockerContainer[] = []
  for (const line of lines) {
    if (!line.startsWith('@c\t')) {
      continue
    }
    const [id, name, image, status] = line.split('\t').slice(1)
    if (!id || !DOCKER_CONTAINER_ID.test(id)) {
      continue
    }
    const row = stats.get(id)
    const [memUsageBytes, memLimitBytes] = parseDockerSizePair(dockerText(row?.MemUsage))
    const [netRxBytes, netTxBytes] = parseDockerSizePair(dockerText(row?.NetIO))
    const [blockReadBytes, blockWriteBytes] = parseDockerSizePair(dockerText(row?.BlockIO))
    containers.push({
      id,
      name: name ?? id,
      image: image ?? '',
      status: status ?? '',
      running: /^Up\b/.test(status ?? ''),
      memUsageBytes,
      memLimitBytes,
      memPercent: figure(row?.MemPerc),
      cpuPercent: figure(row?.CPUPerc),
      netRxBytes,
      netTxBytes,
      blockReadBytes,
      blockWriteBytes,
      pids: figure(row?.PIDs)
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
  if (!DOCKER_CONTAINER_ID.test(containerId)) {
    throw new Error('Unknown container')
  }
  if (!MACHINE_DOCKER_CONTAINER_ACTIONS.includes(action)) {
    throw new Error('Unsupported container action')
  }
  // Without --force, so Docker itself refuses to remove a container that is still running.
  const command = action === 'remove' ? 'rm' : action
  try {
    const result = await runMachineHostScript(connection, `docker ${command} ${containerId}`, {
      timeoutMs: ACTION_TIMEOUT_MS
    })
    if (result.exitCode !== 0) {
      throw new Error(firstErrorLine(result))
    }
  } finally {
    forgetDockerInventory(connection)
  }
}
