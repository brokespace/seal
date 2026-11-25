import type {
  MachineDockerContainerRef,
  MachineDockerDetails
} from '../../../../shared/machines/machine-docker-types'
import { dockerImageKey } from '../../../../shared/machines/machine-docker-types'
import type { MachineFileEntry } from '../../../../shared/machines/machine-types'
import {
  DAY,
  FAKE_DOCKER_IMAGES,
  FAKE_DOCKER_STORED_CONTAINERS,
  FAKE_DOCKER_VOLUMES,
  GB,
  MB,
  hex,
  now
} from './machine-docker-fixture-inventory'

export const FAKE_DOCKER_LOG = `2026-11-13T08:02:11.431Z LOG:  starting PostgreSQL 16.4 on x86_64-pc-linux-gnu
2026-11-13T08:02:11.432Z LOG:  listening on IPv4 address "0.0.0.0", port 5432
2026-11-13T08:02:11.498Z LOG:  database system was shut down at 2026-11-13 08:01:58 UTC
2026-11-13T08:02:11.540Z LOG:  database system is ready to accept connections
2026-11-16T19:40:02.118Z LOG:  checkpoint starting: time
2026-11-16T19:40:31.774Z LOG:  checkpoint complete: wrote 2841 buffers (17.3%); 0 WAL file(s) added
2026-11-16T19:44:19.006Z ERROR:  canceling statement due to statement timeout
2026-11-16T19:44:19.006Z STATEMENT:  SELECT run_id, metric FROM eval_results WHERE suite = 'vit-l'
`

type ContainerSetup = {
  command: string
  ports: string[]
  destination: string
  restartPolicy: string
  exitCode: number
  health: string | null
}

const CONTAINER_SETUP: Record<string, ContainerSetup> = {
  postgres: {
    command: 'docker-entrypoint.sh postgres',
    ports: ['0.0.0.0:5432->5432/tcp'],
    destination: '/var/lib/postgresql/data',
    restartPolicy: 'unless-stopped',
    exitCode: 0,
    health: 'healthy'
  },
  jupyter: {
    command: 'tini -g -- start-notebook.py --NotebookApp.token=',
    ports: ['0.0.0.0:8888->8888/tcp'],
    destination: '/home/jovyan/work',
    restartPolicy: 'no',
    exitCode: 0,
    health: null
  },
  'eval-run-0412': {
    command: 'python -m seal.eval --suite vit-l',
    ports: [],
    destination: '/results',
    restartPolicy: 'no',
    exitCode: 0,
    health: null
  },
  'mlflow-2025': {
    command: 'mlflow server --host 0.0.0.0 --artifacts-destination /mlartifacts',
    ports: [],
    destination: '/mlartifacts',
    restartPolicy: 'on-failure',
    exitCode: 137,
    health: null
  }
}

const VOLUME_LABELS: Record<string, Record<string, string>> = {
  pgdata: { 'com.docker.compose.project': 'seal-db', 'com.docker.compose.volume': 'pgdata' },
  notebooks: { owner: 'research' },
  'mlflow-artifacts': {
    'com.docker.compose.project': 'mlflow',
    'com.docker.compose.volume': 'artifacts'
  }
}

function destinationOf(container: MachineDockerContainerRef): string | null {
  return CONTAINER_SETUP[container.name]?.destination ?? null
}

export function fakeDockerDetails(kind: string, id: string): MachineDockerDetails {
  if (kind === 'container') {
    const stored =
      FAKE_DOCKER_STORED_CONTAINERS.find(
        (container) => container.id.startsWith(id) || container.name === id
      ) ?? FAKE_DOCKER_STORED_CONTAINERS[3]
    const running = stored.running
    const setup = CONTAINER_SETUP[stored.name] ?? CONTAINER_SETUP.postgres
    return {
      kind: 'container',
      id: stored.id,
      name: stored.name,
      state: stored.state,
      running,
      image: stored.image,
      imageId: stored.imageId,
      command: setup.command,
      createdAt: stored.createdAt,
      startedAt: running ? now - 5 * 3_600_000 : (stored.createdAt ?? now),
      finishedAt: running ? null : (stored.createdAt ?? now) + DAY,
      exitCode: running ? null : setup.exitCode,
      restartCount: setup.restartPolicy === 'unless-stopped' ? 2 : 0,
      health: running ? setup.health : null,
      oomKilled: setup.exitCode === 137,
      error: null,
      restartPolicy: setup.restartPolicy,
      ports: running ? setup.ports : [],
      networks: ['bridge'],
      mounts: stored.volumes.map((volume) => ({
        type: 'volume',
        volume,
        source: `/var/lib/docker/volumes/${volume}/_data`,
        destination: setup.destination,
        readOnly: false
      }))
    }
  }
  if (kind === 'volume') {
    const volume = FAKE_DOCKER_VOLUMES.find((entry) => entry.name === id) ?? FAKE_DOCKER_VOLUMES[0]
    return {
      kind: 'volume',
      name: volume.name,
      driver: volume.driver,
      mountpoint: volume.mountpoint,
      scope: 'local',
      createdAt: now - 60 * DAY,
      labels: VOLUME_LABELS[volume.name] ?? {},
      options: volume.driver === 'nfs' ? { type: 'nfs', device: ':/export/datasets' } : {},
      containers: volume.usedBy.map((container) => ({
        ...container,
        destination: destinationOf(container),
        readOnly: false
      }))
    }
  }
  const image =
    FAKE_DOCKER_IMAGES.find((entry) => dockerImageKey(entry) === id || entry.id === id) ??
    FAKE_DOCKER_IMAGES[1]
  return {
    kind: 'image',
    id: image.id,
    tags: image.reference ? [image.reference] : [],
    digests: image.reference
      ? [`${image.reference.split(':')[0]}@sha256:${hex('0f1e2d3c4b5a')}`]
      : [],
    createdAt: image.createdAt,
    sizeBytes: image.sizeBytes,
    architecture: 'amd64',
    os: 'linux',
    layers: [
      { createdBy: 'CMD ["start-notebook.py"]', sizeBytes: 0, createdAt: image.createdAt },
      {
        createdBy: 'RUN /bin/sh -c mamba install --yes pytorch torchvision # buildkit',
        sizeBytes: 6.9 * GB,
        createdAt: image.createdAt
      },
      {
        createdBy: 'COPY --chown=1000:100 requirements.txt /tmp/ # buildkit',
        sizeBytes: 4096,
        createdAt: image.createdAt
      },
      {
        createdBy: 'RUN /bin/sh -c apt-get update && apt-get install -y build-essential',
        sizeBytes: 2.1 * GB,
        createdAt: (image.createdAt ?? now) - DAY
      },
      {
        createdBy: '/bin/sh -c #(nop) ADD file:6f1a… in /',
        sizeBytes: 77 * MB,
        createdAt: (image.createdAt ?? now) - 30 * DAY
      }
    ],
    containers: image.usedBy
  }
}

function entry(name: string, kind: 'file' | 'directory', size = 0): MachineFileEntry {
  return { name, kind, isDirectoryLike: kind === 'directory', size, mtimeMs: now - DAY }
}

export const FAKE_DOCKER_VOLUME_TREE: Record<string, MachineFileEntry[]> = {
  '/': [
    entry('base', 'directory'),
    entry('pg_wal', 'directory'),
    entry('PG_VERSION', 'file', 3),
    entry('postgresql.conf', 'file', 29_770),
    entry('postmaster.pid', 'file', 94)
  ],
  '/base': [entry('1', 'directory'), entry('16384', 'directory')],
  '/pg_wal': [entry('000000010000000A0000003F', 'file', 16 * MB)]
}

export const FAKE_DOCKER_VOLUME_FILES: Record<string, string> = {
  '/PG_VERSION': '16\n',
  '/postgresql.conf': "listen_addresses = '*'\nmax_connections = 200\nshared_buffers = 1GB\n",
  '/postmaster.pid': '1\n/var/lib/postgresql/data\n1763020931\n5432\n'
}
