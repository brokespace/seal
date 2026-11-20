import type { MachineGpuProcess } from '../../../../../shared/machines/machine-gpu-types'
import type { MachineDockerContainer } from '../../../../../shared/machines/machine-resource-types'

export type MachineDockerStatsSort = 'cpu' | 'memory' | 'net' | 'block' | 'pids'

function total(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0)
}

function figure(container: MachineDockerContainer, sort: MachineDockerStatsSort): number | null {
  switch (sort) {
    case 'cpu':
      return container.cpuPercent
    case 'memory':
      return container.memUsageBytes
    case 'net':
      return total(container.netRxBytes, container.netTxBytes)
    case 'block':
      return total(container.blockReadBytes, container.blockWriteBytes)
    case 'pids':
      return container.pids
  }
}

function sameContainer(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a)
}

/** The GPUs each container has a process on, in order and each once, keyed by the container's id. */
export function gpuIndexesByContainer(
  processes: readonly MachineGpuProcess[]
): Map<string, number[]> {
  const byContainer = new Map<string, Set<number>>()
  for (const use of processes) {
    if (!use.container) {
      continue
    }
    const indexes = byContainer.get(use.container.id) ?? new Set<number>()
    if (use.gpuIndex !== null) {
      indexes.add(use.gpuIndex)
    }
    byContainer.set(use.container.id, indexes)
  }
  return new Map([...byContainer].map(([id, indexes]) => [id, [...indexes].sort((a, b) => a - b)]))
}

/** A GPU process names its container by the id in its cgroup, which Docker may list shortened. */
export function gpuIndexesOfContainer(
  onGpus: ReadonlyMap<string, number[]>,
  containerId: string
): number[] | undefined {
  for (const [id, indexes] of onGpus) {
    if (sameContainer(id, containerId)) {
      return indexes
    }
  }
  return undefined
}

/**
 * The running containers a resource view lists: those the filter finds, the largest figure first
 * and those without that figure last. `onGpus` keeps only the containers with a process on a GPU.
 */
export function rankDockerContainers(
  containers: readonly MachineDockerContainer[],
  options: {
    sort: MachineDockerStatsSort
    filter: string
    onGpus?: ReadonlyMap<string, number[]>
  }
): MachineDockerContainer[] {
  const needle = options.filter.trim().toLowerCase()
  const { onGpus } = options
  return containers
    .filter(
      (container) =>
        container.running &&
        (!onGpus || gpuIndexesOfContainer(onGpus, container.id) !== undefined) &&
        (needle === '' ||
          container.name.toLowerCase().includes(needle) ||
          container.image.toLowerCase().includes(needle) ||
          container.id.startsWith(needle))
    )
    .sort((a, b) => {
      const left = figure(a, options.sort)
      const right = figure(b, options.sort)
      if (left === null || right === null) {
        return (left === null ? 1 : 0) - (right === null ? 1 : 0) || a.name.localeCompare(b.name)
      }
      return right - left || a.name.localeCompare(b.name)
    })
}
