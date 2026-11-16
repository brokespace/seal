import { describe, expect, it } from 'vitest'
import type {
  MachineDockerContainerRef,
  MachineDockerInventory,
  MachineDockerVolume
} from '../../../../../shared/machines/machine-docker-types'
import {
  dockerStorageItems,
  filterDockerStorageItems,
  sortDockerStorageItems
} from './machine-docker-storage-rows'

function ref(name: string, running: boolean): MachineDockerContainerRef {
  return { id: name.padEnd(64, '0'), name, state: running ? 'running' : 'exited', running }
}

function inventoryOf(part: Partial<MachineDockerInventory>): MachineDockerInventory {
  return {
    rows: [],
    images: [],
    containers: [],
    volumes: [],
    buildCache: [],
    buildCacheOmitted: 0,
    collectedAt: 0,
    ...part
  }
}

function volume(
  name: string,
  sizeBytes: number | null,
  usedBy: MachineDockerContainerRef[] = []
): MachineDockerVolume {
  return {
    name,
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${name}/_data`,
    sizeBytes,
    usedBy
  }
}

describe('docker storage rows', () => {
  it('tells an image a stopped container still holds from one nothing uses', () => {
    const image = { tags: [], sizeBytes: 100, uniqueBytes: 40, createdAt: null }
    const items = dockerStorageItems(
      inventoryOf({
        images: [
          {
            ...image,
            id: 'sha256:aaa',
            reference: 'app:1',
            usedBy: [ref('old', false), ref('web', true)]
          },
          { ...image, id: 'sha256:bbb', reference: 'app:2', usedBy: [ref('old', false)] },
          { ...image, id: 'sha256:ccc', reference: 'app:3', usedBy: [] },
          { ...image, id: 'sha256:ddd', reference: null, usedBy: [] }
        ]
      }),
      'images'
    )

    expect(items.map((item) => [item.key, item.status])).toEqual([
      ['app:1', 'in-use'],
      ['app:2', 'stopped-only'],
      ['app:3', 'unused'],
      ['sha256:ddd', 'dangling']
    ])
    expect(
      filterDockerStorageItems(items, { filter: '', reclaimableOnly: true }).map((item) => item.key)
    ).toEqual(['app:3', 'sha256:ddd'])
  })

  it('keeps volumes of unknown size last whichever way the size sort runs', () => {
    const items = dockerStorageItems(
      inventoryOf({
        volumes: [
          volume('nfs', null),
          volume('small', 10),
          volume('big', 900),
          volume('cifs', null)
        ]
      }),
      'volumes'
    )

    expect(sortDockerStorageItems(items, 'size', true).map((item) => item.key)).toEqual([
      'big',
      'small',
      'cifs',
      'nfs'
    ])
    expect(sortDockerStorageItems(items, 'size', false).map((item) => item.key)).toEqual([
      'small',
      'big',
      'cifs',
      'nfs'
    ])
  })

  it('sorts by status with what a cleanup takes first', () => {
    const items = dockerStorageItems(
      inventoryOf({
        volumes: [
          volume('live', 1, [ref('db', true)]),
          volume('kept', 1, [ref('old', false)]),
          volume('free', 1)
        ]
      }),
      'volumes'
    )

    expect(sortDockerStorageItems(items, 'status', false).map((item) => item.key)).toEqual([
      'free',
      'kept',
      'live'
    ])
  })
})
