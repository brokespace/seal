export type FakeDockerImage = {
  /** `sha256:` and 64 hex characters. */
  id: string
  /** `repository:tag`; none makes the image dangling. */
  tags: string[]
  createdAt: string
  sizeBytes: number
  uniqueBytes: number
  /** False for an image that cannot run `sh`, so it cannot be a volume helper. */
  shell: boolean
  /** Newest first. */
  layers: { createdBy: string; sizeBytes: number; createdAt: string }[]
}

export type FakeDockerContainer = {
  /** 64 hex characters. */
  id: string
  name: string
  image: string
  imageId: string
  state: 'running' | 'exited' | 'created' | 'paused'
  exitCode: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  command: string[]
  sizeBytes: number
  mounts: { volume: string; destination: string; readOnly: boolean }[]
  ports: Record<string, { HostIp: string; HostPort: string }[] | null>
  networks: string[]
  restartPolicy: string
  health: string | null
  /** Each line starts with its RFC 3339 timestamp. */
  logs: string[]
  stats: {
    cpuPercent: number
    memUsageBytes: number
    memLimitBytes: number
    netRxBytes: number
    netTxBytes: number
    blockReadBytes: number
    blockWriteBytes: number
    pids: number
  }
}

export type FakeDockerVolume = {
  name: string
  driver: string
  createdAt: string
  labels: Record<string, string>
  sizeBytes: number
  /** Relative path to content; written to the volume's folder the first time it is read. */
  files: Record<string, string>
  /** True reports the real folder as the mountpoint; false reports one the account cannot read. */
  readable: boolean
  /** Where the files live; defaults to `docker-volumes/<name>` beside the script. */
  dir?: string
}

export type FakeDockerBuildCacheRecord = {
  id: string
  /** The record this one builds on, or empty. */
  parent: string
  cacheType: string
  description: string
  sizeBytes: number
  inUse: boolean
  shared: boolean
  createdAt: string
  lastUsedAt: string
  usageCount: number
}

/** What the fake `docker` CLI holds; it reads and rewrites this as JSON. */
export type FakeDockerState = {
  /** Every command fails the way Docker does for an account outside the `docker` group. */
  permissionDenied: boolean
  /** Every command fails the way Docker does when its daemon is not running. */
  daemonDown: boolean
  images: FakeDockerImage[]
  containers: FakeDockerContainer[]
  volumes: FakeDockerVolume[]
  buildCache: FakeDockerBuildCacheRecord[]
}

function hexId(pair: string): string {
  return pair.repeat(32)
}

/** Names and ids of what `fakeDockerState()` in fake-docker-default-state.ts holds. */
export const FAKE_DOCKER = {
  images: {
    /** Used by running `web` and stopped `old-job`. */
    nginx: { reference: 'nginx:1.27', id: `sha256:${hexId('a1')}` },
    /** Used by running `db`. */
    postgres: { reference: 'postgres:16', id: `sha256:${hexId('b2')}` },
    /** Used only by stopped `migrate`. */
    node: { reference: 'node:20-alpine', id: `sha256:${hexId('c3')}` },
    /** Unused. */
    redis: { reference: 'redis:7', id: `sha256:${hexId('d4')}` },
    /** Unused, the smallest image, and without a shell. */
    distroless: { reference: 'gcr.io/distroless/static:latest', id: `sha256:${hexId('e5')}` },
    /** Unused and untagged. */
    dangling: { reference: null, id: `sha256:${hexId('f6')}` }
  },
  containers: {
    web: { name: 'web', id: hexId('11') },
    db: { name: 'db', id: hexId('22') },
    migrate: { name: 'migrate', id: hexId('33') },
    oldJob: { name: 'old-job', id: hexId('44') }
  },
  volumes: {
    /** Mounted by running `db`. */
    pgdata: 'pgdata',
    /** Mounted only by stopped `migrate`. */
    migrations: 'migrations',
    /** Unused; holds `notes.txt` and `logs/app.log`. */
    scratch: 'scratch'
  },
  buildCache: {
    /** `layer` builds on it, so Docker keeps it until `layer` is gone. */
    base: 'w4yp0uzsetd0osqk2ljgjxcfw',
    layer: 'and9k40h85wu07hkc4ksbrmjc',
    context: 'qq7e56rcaknhmhzdrvtdinoge',
    /** A build is using it. */
    busy: 'k5qc55jgad7i7yfsrgc1jsh3x'
  }
} as const
