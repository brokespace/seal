import { describe, expect, it } from 'vitest'
import type { MachineDockerContainer } from '../../../../../shared/machines/machine-resource-types'
import {
  gpuIndexesByContainer,
  gpuIndexesOfContainer,
  rankDockerContainers
} from './machine-docker-container-stats'

function container(
  name: string,
  figures: Partial<MachineDockerContainer> = {}
): MachineDockerContainer {
  return {
    id: `${name}-id`.padEnd(64, '0'),
    name,
    image: `${name}:latest`,
    status: 'Up 2 hours',
    running: true,
    memUsageBytes: null,
    memLimitBytes: null,
    memPercent: null,
    cpuPercent: null,
    netRxBytes: null,
    netTxBytes: null,
    blockReadBytes: null,
    blockWriteBytes: null,
    pids: null,
    ...figures
  }
}

const names = (containers: MachineDockerContainer[]): string[] =>
  containers.map((entry) => entry.name)

describe('rankDockerContainers', () => {
  it('ranks by the chosen figure, largest first, with unmeasured containers last', () => {
    const containers = [
      container('idle', { cpuPercent: 0.5, memUsageBytes: 900 }),
      container('starting'),
      container('busy', { cpuPercent: 240, memUsageBytes: 100 })
    ]
    expect(names(rankDockerContainers(containers, { sort: 'cpu', filter: '' }))).toEqual([
      'busy',
      'idle',
      'starting'
    ])
    expect(names(rankDockerContainers(containers, { sort: 'memory', filter: '' }))).toEqual([
      'idle',
      'busy',
      'starting'
    ])
  })

  it('ranks network and block I/O by both directions added up', () => {
    const containers = [
      container('uploader', { netRxBytes: 10, netTxBytes: 500 }),
      container('downloader', { netRxBytes: 400, netTxBytes: 20 }),
      container('receiver', { netRxBytes: 450, netTxBytes: null })
    ]
    expect(names(rankDockerContainers(containers, { sort: 'net', filter: '' }))).toEqual([
      'uploader',
      'receiver',
      'downloader'
    ])
  })

  it('lists only running containers', () => {
    const containers = [container('up', { cpuPercent: 1 }), container('down', { running: false })]
    expect(names(rankDockerContainers(containers, { sort: 'cpu', filter: '' }))).toEqual(['up'])
  })

  it('finds a container by name, image or the start of its id', () => {
    const containers = [
      container('postgres', { image: 'postgres:16', id: 'aa11'.padEnd(64, '0') }),
      container('notebook', {
        image: 'jupyter/pytorch-notebook:latest',
        id: 'bb22'.padEnd(64, '0')
      })
    ]
    const found = (filter: string): string[] =>
      names(rankDockerContainers(containers, { sort: 'cpu', filter }))
    expect(found(' Post ')).toEqual(['postgres'])
    expect(found('pytorch')).toEqual(['notebook'])
    expect(found('bb22')).toEqual(['notebook'])
    expect(found('2200')).toEqual([])
  })

  it('keeps only the containers with a process on a GPU when asked', () => {
    const trainer = container('trainer', { id: 'c0ffee'.padEnd(64, '1') })
    const onGpus = gpuIndexesByContainer([
      {
        pid: 1,
        gpuIndex: 3,
        memoryBytes: 1,
        name: 'python',
        container: { id: trainer.id, name: 'trainer' }
      },
      {
        pid: 2,
        gpuIndex: 0,
        memoryBytes: 1,
        name: 'python',
        container: { id: trainer.id, name: 'trainer' }
      },
      {
        pid: 2,
        gpuIndex: 3,
        memoryBytes: 1,
        name: 'python',
        container: { id: trainer.id, name: 'trainer' }
      },
      { pid: 9, gpuIndex: 1, memoryBytes: 1, name: 'tritonserver', container: null }
    ])
    const ranked = rankDockerContainers([container('web'), trainer], {
      sort: 'memory',
      filter: '',
      onGpus
    })
    expect(names(ranked)).toEqual(['trainer'])
    expect(gpuIndexesOfContainer(onGpus, trainer.id)).toEqual([0, 3])
  })

  it('matches a GPU process to a container Docker lists by a shortened id', () => {
    const full = 'abcdef012345'.padEnd(64, '9')
    const onGpus = gpuIndexesByContainer([
      {
        pid: 1,
        gpuIndex: 2,
        memoryBytes: null,
        name: 'python',
        container: { id: full, name: null }
      }
    ])
    expect(gpuIndexesOfContainer(onGpus, 'abcdef012345')).toEqual([2])
    expect(gpuIndexesOfContainer(onGpus, '0123456789ab')).toBeUndefined()
  })
})
