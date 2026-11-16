import {
  FAKE_DOCKER,
  type FakeDockerContainer,
  type FakeDockerImage,
  type FakeDockerState
} from './fake-docker-state'

const IDLE_STATS: FakeDockerContainer['stats'] = {
  cpuPercent: 0,
  memUsageBytes: 0,
  memLimitBytes: 0,
  netRxBytes: 0,
  netTxBytes: 0,
  blockReadBytes: 0,
  blockWriteBytes: 0,
  pids: 0
}

function fakeImage(
  image: { reference: string | null; alias?: string; id: string },
  sizeBytes: number,
  uniqueBytes: number,
  createdAt: string,
  shell = true
): FakeDockerImage {
  return {
    id: image.id,
    tags: [image.reference, image.alias].flatMap((tag) => (tag ? [tag] : [])),
    createdAt,
    sizeBytes,
    uniqueBytes,
    shell,
    layers: [
      { createdBy: 'CMD ["start"]', sizeBytes: 0, createdAt },
      { createdBy: 'RUN /bin/sh -c install', sizeBytes: uniqueBytes, createdAt },
      {
        createdBy: 'ADD rootfs.tar.xz / # buildkit',
        sizeBytes: sizeBytes - uniqueBytes,
        createdAt
      }
    ]
  }
}

/** A small machine: two running and two stopped containers, six images, three volumes, four cache records. */
export function fakeDockerState(): FakeDockerState {
  const { images, containers, volumes, buildCache } = FAKE_DOCKER
  return {
    permissionDenied: false,
    daemonDown: false,
    images: [
      fakeImage(images.nginx, 192_000_000, 120_000_000, '2026-10-02T08:15:00Z'),
      fakeImage(images.postgres, 438_000_000, 438_000_000, '2026-09-20T11:30:00Z'),
      fakeImage(images.node, 135_000_000, 127_000_000, '2026-08-11T07:45:00Z'),
      fakeImage(images.redis, 117_000_000, 117_000_000, '2026-07-05T16:00:00Z'),
      fakeImage(images.distroless, 2_100_000, 2_100_000, '2026-06-01T00:00:00Z', false),
      fakeImage(images.dangling, 96_000_000, 64_000_000, '2026-10-30T09:20:00Z')
    ],
    containers: [
      {
        ...containers.web,
        image: images.nginx.reference,
        imageId: images.nginx.id,
        state: 'running',
        exitCode: 0,
        createdAt: '2026-11-10T08:00:00Z',
        startedAt: '2026-11-10T08:00:01Z',
        finishedAt: null,
        command: ['nginx', '-g', 'daemon off;'],
        sizeBytes: 1_090,
        mounts: [],
        ports: {
          '443/tcp': null,
          '80/tcp': [
            { HostIp: '0.0.0.0', HostPort: '8080' },
            { HostIp: '::', HostPort: '8080' }
          ]
        },
        networks: ['bridge'],
        restartPolicy: 'unless-stopped',
        health: 'healthy',
        logs: [
          '2026-11-10T08:00:01.120000000Z start worker processes',
          '2026-11-16T19:58:12.004000000Z 172.17.0.1 - - "GET / HTTP/1.1" 200 615',
          '2026-11-16T19:58:14.870000000Z 172.17.0.1 - - "GET /missing HTTP/1.1" 404 153'
        ],
        stats: {
          cpuPercent: 1.5,
          memUsageBytes: 24 * 1024 ** 2,
          memLimitBytes: 2 * 1024 ** 3,
          netRxBytes: 1_200_000,
          netTxBytes: 3_400_000,
          blockReadBytes: 8_190_000,
          blockWriteBytes: 0,
          pids: 5
        }
      },
      {
        ...containers.db,
        image: images.postgres.reference,
        imageId: images.postgres.id,
        state: 'running',
        exitCode: 0,
        createdAt: '2026-11-10T07:59:00Z',
        startedAt: '2026-11-10T07:59:02Z',
        finishedAt: null,
        command: ['docker-entrypoint.sh', 'postgres'],
        sizeBytes: 63,
        mounts: [
          { volume: volumes.pgdata, destination: '/var/lib/postgresql/data', readOnly: false }
        ],
        ports: { '5432/tcp': null },
        networks: ['bridge', 'backend'],
        restartPolicy: 'always',
        health: null,
        logs: ['2026-11-10T07:59:03.500000000Z database system is ready to accept connections'],
        stats: {
          cpuPercent: 12.25,
          memUsageBytes: 1.5 * 1024 ** 3,
          memLimitBytes: 2 * 1024 ** 3,
          netRxBytes: 48_300,
          netTxBytes: 126,
          blockReadBytes: 212_000_000,
          blockWriteBytes: 1_480_000_000,
          pids: 14
        }
      },
      {
        ...containers.migrate,
        image: images.node.reference,
        imageId: images.node.id,
        state: 'exited',
        exitCode: 0,
        createdAt: '2026-11-09T18:30:00Z',
        startedAt: '2026-11-09T18:30:01Z',
        finishedAt: '2026-11-09T18:30:20Z',
        command: ['node', 'migrate.js'],
        sizeBytes: 4_100,
        mounts: [{ volume: volumes.migrations, destination: '/app/migrations', readOnly: true }],
        ports: {},
        networks: ['bridge'],
        restartPolicy: 'no',
        health: null,
        logs: ['2026-11-09T18:30:19.000000000Z 3 migrations applied'],
        stats: IDLE_STATS
      },
      {
        ...containers.oldJob,
        image: images.nginx.reference,
        imageId: images.nginx.id,
        state: 'exited',
        exitCode: 1,
        createdAt: '2026-11-02T10:00:00Z',
        startedAt: '2026-11-02T10:00:01Z',
        finishedAt: '2026-11-02T10:00:05Z',
        command: ['sh', '-c', 'nginx -t'],
        sizeBytes: 28_700_000,
        mounts: [],
        ports: {},
        networks: ['bridge'],
        restartPolicy: 'no',
        health: null,
        logs: ['2026-11-02T10:00:05.000000000Z nginx: configuration file test failed'],
        stats: IDLE_STATS
      }
    ],
    volumes: [
      {
        name: volumes.pgdata,
        driver: 'local',
        createdAt: '2026-11-10T07:59:00Z',
        labels: { 'com.docker.compose.project': 'shop' },
        sizeBytes: 2_100_000_000,
        files: { PG_VERSION: '16\n', 'postgresql.conf': 'max_connections = 100\n' },
        readable: false
      },
      {
        name: volumes.migrations,
        driver: 'local',
        createdAt: '2026-11-09T18:29:00Z',
        labels: {},
        sizeBytes: 12_300,
        files: { '001_init.sql': 'CREATE TABLE orders (id serial PRIMARY KEY);\n' },
        readable: false
      },
      {
        name: volumes.scratch,
        driver: 'local',
        createdAt: '2026-10-01T12:00:00Z',
        labels: {},
        sizeBytes: 512_000_000,
        files: { 'notes.txt': 'scratch notes\n', 'logs/app.log': 'started\nstopped\n' },
        readable: false
      }
    ],
    buildCache: [
      {
        id: buildCache.base,
        parent: '',
        cacheType: 'regular',
        description: 'pulled from docker.io/library/node:20-alpine',
        sizeBytes: 127_000_000,
        inUse: false,
        shared: true,
        createdAt: '2026-11-08T09:00:00.515762316Z',
        lastUsedAt: '2026-11-15T14:00:00.981746305Z',
        usageCount: 6
      },
      {
        id: buildCache.layer,
        parent: buildCache.base,
        cacheType: 'regular',
        description: 'mount / from exec /bin/sh -c npm ci',
        sizeBytes: 310_000_000,
        inUse: false,
        shared: false,
        createdAt: '2026-11-08T09:01:10.686421869Z',
        lastUsedAt: '2026-11-15T14:00:02.982269072Z',
        usageCount: 6
      },
      {
        id: buildCache.context,
        parent: '',
        cacheType: 'source.local',
        description: 'local source for context',
        sizeBytes: 8_190,
        inUse: false,
        shared: false,
        createdAt: '2026-11-08T09:00:00.500085868Z',
        lastUsedAt: '2026-11-15T14:00:00.981933370Z',
        usageCount: 6
      },
      {
        id: buildCache.busy,
        parent: '',
        cacheType: 'exec.cachemount',
        description: 'cached mount /root/.npm from exec /bin/sh -c npm ci',
        sizeBytes: 96_000_000,
        inUse: true,
        shared: false,
        createdAt: '2026-11-08T09:01:00.899074554Z',
        lastUsedAt: '2026-11-16T19:59:00.982392895Z',
        usageCount: 9
      }
    ]
  }
}
