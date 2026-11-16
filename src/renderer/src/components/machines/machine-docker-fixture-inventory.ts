import type {
  MachineDockerBuildCacheRecord,
  MachineDockerContainerRef,
  MachineDockerImage,
  MachineDockerInventory,
  MachineDockerStoredContainer,
  MachineDockerVolume
} from '../../../../shared/machines/machine-docker-types'

export const now = Date.now()
export const GB = 1024 ** 3
export const MB = 1024 ** 2
export const DAY = 86_400_000

export function hex(seed: string): string {
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64)
}

export const POSTGRES: MachineDockerContainerRef = {
  id: hex('1c2d3e4f5a6b'),
  name: 'postgres',
  state: 'running',
  running: true
}
export const JUPYTER: MachineDockerContainerRef = {
  // The container the GPU fixtures put a notebook process in.
  id: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
  name: 'jupyter',
  state: 'running',
  running: true
}
export const EVAL_RUN: MachineDockerContainerRef = {
  id: hex('43b92ff52610'),
  name: 'eval-run-0412',
  state: 'exited',
  running: false
}
export const MLFLOW_OLD: MachineDockerContainerRef = {
  id: hex('9d0e1f2a3b4c'),
  name: 'mlflow-2025',
  state: 'exited',
  running: false
}

const IMAGE_IDS = {
  postgres: `sha256:${hex('a1b2c3d4e5f6')}`,
  jupyter: `sha256:${hex('b2c3d4e5f6a1')}`,
  eval: `sha256:${hex('c3d4e5f6a1b2')}`,
  cuda: `sha256:${hex('d4e5f6a1b2c3')}`,
  mlflow: `sha256:${hex('e5f6a1b2c3d4')}`,
  danglingA: `sha256:${hex('9f1c2ab04e77')}`,
  danglingB: `sha256:${hex('51d0a6c3be19')}`
}

export const FAKE_DOCKER_IMAGES: MachineDockerImage[] = [
  {
    id: IMAGE_IDS.cuda,
    reference: 'nvidia/cuda:12.4.1-devel',
    sizeBytes: 18.5 * GB,
    uniqueBytes: 18.5 * GB,
    createdAt: now - 190 * DAY,
    usedBy: []
  },
  {
    id: IMAGE_IDS.jupyter,
    reference: 'jupyter/pytorch-notebook:latest',
    sizeBytes: 11.2 * GB,
    uniqueBytes: 9.8 * GB,
    createdAt: now - 42 * DAY,
    usedBy: [JUPYTER]
  },
  {
    id: IMAGE_IDS.eval,
    reference: 'seal/eval:2026.04',
    sizeBytes: 9.6 * GB,
    uniqueBytes: 4.1 * GB,
    createdAt: now - 30 * DAY,
    usedBy: [EVAL_RUN]
  },
  {
    id: IMAGE_IDS.danglingA,
    reference: null,
    sizeBytes: 7.4 * GB,
    uniqueBytes: 7.4 * GB,
    createdAt: now - 12 * DAY,
    usedBy: []
  },
  {
    id: IMAGE_IDS.danglingB,
    reference: null,
    sizeBytes: 5.1 * GB,
    uniqueBytes: 5.1 * GB,
    createdAt: now - 16 * DAY,
    usedBy: []
  },
  {
    id: IMAGE_IDS.mlflow,
    reference: 'ghcr.io/mlflow/mlflow:v2.9.2',
    sizeBytes: 1.3 * GB,
    uniqueBytes: 1.1 * GB,
    createdAt: now - 400 * DAY,
    usedBy: [MLFLOW_OLD]
  },
  {
    id: IMAGE_IDS.postgres,
    reference: 'postgres:16',
    sizeBytes: 432 * MB,
    uniqueBytes: 432 * MB,
    createdAt: now - 75 * DAY,
    usedBy: [POSTGRES]
  }
]

export const FAKE_DOCKER_STORED_CONTAINERS: MachineDockerStoredContainer[] = [
  {
    ...EVAL_RUN,
    image: 'seal/eval:2026.04',
    imageId: IMAGE_IDS.eval,
    status: 'Exited (0) 2 weeks ago',
    sizeBytes: 1.9 * GB,
    createdAt: now - 15 * DAY,
    volumes: []
  },
  {
    ...JUPYTER,
    image: 'jupyter/pytorch-notebook:latest',
    imageId: IMAGE_IDS.jupyter,
    status: 'Up 5 hours',
    sizeBytes: 412 * MB,
    createdAt: now - 9 * DAY,
    volumes: ['notebooks']
  },
  {
    ...MLFLOW_OLD,
    image: 'ghcr.io/mlflow/mlflow:v2.9.2',
    imageId: IMAGE_IDS.mlflow,
    status: 'Exited (137) 7 months ago',
    sizeBytes: 88 * MB,
    createdAt: now - 380 * DAY,
    volumes: ['mlflow-artifacts']
  },
  {
    ...POSTGRES,
    image: 'postgres:16',
    imageId: IMAGE_IDS.postgres,
    status: 'Up 3 days',
    sizeBytes: 63,
    createdAt: now - 60 * DAY,
    volumes: ['pgdata']
  }
]

export const FAKE_DOCKER_VOLUMES: MachineDockerVolume[] = [
  {
    name: 'pgdata',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/pgdata/_data',
    sizeBytes: 141 * GB,
    usedBy: [POSTGRES]
  },
  {
    name: 'notebooks',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/notebooks/_data',
    sizeBytes: 38 * GB,
    usedBy: [JUPYTER]
  },
  {
    name: 'mlflow-artifacts',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/mlflow-artifacts/_data',
    sizeBytes: 18 * GB,
    usedBy: [MLFLOW_OLD]
  },
  {
    name: 'hf-cache',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/hf-cache/_data',
    sizeBytes: 14.2 * GB,
    usedBy: []
  },
  {
    name: hex('5e6f7a8b9c0d'),
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${hex('5e6f7a8b9c0d')}/_data`,
    sizeBytes: 812 * MB,
    usedBy: []
  },
  {
    name: 'nfs-datasets',
    driver: 'nfs',
    mountpoint: '/mnt/nfs/datasets',
    sizeBytes: null,
    usedBy: []
  }
]

/** One build cache record; `text` is what the build step ran, as BuildKit reports it. */
function cacheRecord(
  id: string,
  cacheType: string,
  text: string,
  sizeBytes: number,
  ages: { created: number; used: number },
  inUse = false
): MachineDockerBuildCacheRecord {
  return {
    id,
    cacheType,
    description: text,
    sizeBytes,
    inUse,
    shared: inUse,
    createdAt: now - ages.created,
    lastUsedAt: now - ages.used
  }
}

export const FAKE_DOCKER_BUILD_CACHE: MachineDockerBuildCacheRecord[] = [
  cacheRecord(
    'k3v9s1q7xw2m8n4p6r0t5y1za',
    'regular',
    'RUN pip install -r requirements.txt',
    21.4 * GB,
    { created: 20 * DAY, used: 3 * DAY }
  ),
  cacheRecord(
    'b7c2d9e4f1a6g3h8j5k0l2m9n',
    'exec.cachemount',
    'mount / from exec /bin/sh -c pnpm install --frozen-lockfile',
    12.8 * GB,
    { created: 45 * DAY, used: 2 * DAY }
  ),
  cacheRecord(
    'q1w2e3r4t5y6u7i8o9p0a1s2d',
    'regular',
    'COPY . /workspace',
    6.3 * GB,
    { created: 2 * DAY, used: 3_600_000 },
    true
  ),
  cacheRecord('z9x8c7v6b5n4m3l2k1j0h9g8f', 'source.local', 'local source for context', 3.5 * GB, {
    created: 70 * DAY,
    used: 30 * DAY
  })
]

export const FAKE_DOCKER_INVENTORY: MachineDockerInventory = {
  rows: [
    { kind: 'images', count: 7, sizeBytes: 53.5 * GB, reclaimableBytes: 31 * GB },
    { kind: 'containers', count: 4, sizeBytes: 2.4 * GB, reclaimableBytes: 1.9 * GB },
    { kind: 'volumes', count: 6, sizeBytes: 212 * GB, reclaimableBytes: 15 * GB },
    { kind: 'build-cache', count: 240, sizeBytes: 44 * GB, reclaimableBytes: 37.7 * GB }
  ],
  images: FAKE_DOCKER_IMAGES,
  containers: FAKE_DOCKER_STORED_CONTAINERS,
  volumes: FAKE_DOCKER_VOLUMES,
  buildCache: FAKE_DOCKER_BUILD_CACHE,
  buildCacheOmitted: 236,
  collectedAt: now
}
