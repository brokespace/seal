import type {
  MachineDockerContainerDetails,
  MachineDockerDetailKind,
  MachineDockerDetails,
  MachineDockerDetailTarget,
  MachineDockerImageDetails,
  MachineDockerVolumeDetails
} from '../../../shared/machines/machine-docker-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../connection/machine-connection'
import {
  containerRef,
  DOCKER_ALL_CONTAINER_USE_COMMAND,
  DOCKER_NAME,
  dockerExecError,
  dockerJsonRows,
  dockerText,
  isDockerJsonRow,
  parseDockerContainerUses,
  parseDockerMounts,
  parseDockerSize,
  parseDockerTime,
  sameDockerId,
  shortDockerId,
  type DockerJsonRow
} from './machine-docker-output'
import { runMachineHostScript } from './machine-host-script'

const DETAILS_TIMEOUT_MS = 30_000
const MAX_LAYERS = 200
/** A build step's command has no length limit; the layers together must fit one answer. */
const MAX_HISTORY_BYTES = 400_000

const SCRIPTS: Record<MachineDockerDetailKind, (id: string) => string> = {
  container: (id) => `
seal_docker_object=$(docker container inspect --format '{{json .}}' ${id}) || return 1
printf '@o %s\\n' "$seal_docker_object"
`,
  image: (id) => `
seal_docker_object=$(docker image inspect --format '{{json .}}' ${id}) || return 1
printf '@o %s\\n' "$seal_docker_object"
${DOCKER_ALL_CONTAINER_USE_COMMAND}
docker image ls --all --no-trunc --format '{{.ID}} {{.Size}}' 2>/dev/null | sed -n "s/^$(printf '%s' "$seal_docker_object" | sed -n 's/.*"Id":"\\([0-9a-z:]*\\)".*/\\1/p') /@z /p" | head -n 1
docker history --no-trunc --format '{{json .}}' ${id} 2>/dev/null | head -n ${MAX_LAYERS} | head -c ${MAX_HISTORY_BYTES} | sed 's/^/@h /'
`,
  volume: (id) => `
seal_docker_object=$(docker volume inspect --format '{{json .}}' ${id}) || return 1
printf '@o %s\\n' "$seal_docker_object"
${DOCKER_ALL_CONTAINER_USE_COMMAND}
`
}

function fields(value: unknown): DockerJsonRow {
  return isDockerJsonRow(value) ? value : {}
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function textMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/** `NetworkSettings.Ports` as `docker ps` words them: `0.0.0.0:8080->80/tcp`, or `80/tcp` unpublished. */
function publishedPorts(value: unknown): string[] {
  const ports = new Set<string>()
  for (const [port, bindings] of Object.entries(fields(value))) {
    const published = Array.isArray(bindings) ? bindings.map(fields) : []
    if (published.length === 0) {
      ports.add(port)
    }
    for (const binding of published) {
      const ip = dockerText(binding.HostIp)
      ports.add(`${ip.includes(':') ? `[${ip}]` : ip}:${dockerText(binding.HostPort)}->${port}`)
    }
  }
  return [...ports]
}

function parseContainerDetails(document: DockerJsonRow): MachineDockerContainerDetails {
  const state = fields(document.State)
  const config = fields(document.Config)
  const network = fields(document.NetworkSettings)
  const id = dockerText(document.Id)
  const running = state.Running === true
  return {
    kind: 'container',
    id,
    name: dockerText(document.Name).replace(/^\//, '') || shortDockerId(id),
    state: dockerText(state.Status),
    running,
    image: dockerText(config.Image),
    imageId: dockerText(document.Image) || null,
    command: [dockerText(document.Path), ...texts(document.Args)].filter(Boolean).join(' '),
    createdAt: parseDockerTime(document.Created),
    startedAt: parseDockerTime(state.StartedAt),
    finishedAt: parseDockerTime(state.FinishedAt),
    exitCode: !running && typeof state.ExitCode === 'number' ? state.ExitCode : null,
    restartCount: typeof document.RestartCount === 'number' ? document.RestartCount : 0,
    health: dockerText(fields(state.Health).Status) || null,
    oomKilled: state.OOMKilled === true,
    error: dockerText(state.Error) || null,
    restartPolicy: dockerText(fields(fields(document.HostConfig).RestartPolicy).Name) || null,
    ports: publishedPorts(network.Ports),
    networks: Object.keys(fields(network.Networks)),
    mounts: parseDockerMounts(document.Mounts)
  }
}

function parseImageDetails(document: DockerJsonRow, lines: string[]): MachineDockerImageDetails {
  const id = dockerText(document.Id)
  // The image list counts unpacked layers too, which `inspect` leaves out on the containerd store.
  const listed = lines.find((line) => line.startsWith('@z '))?.slice('@z '.length)
  return {
    kind: 'image',
    id,
    tags: texts(document.RepoTags),
    digests: texts(document.RepoDigests),
    createdAt: parseDockerTime(document.Created),
    sizeBytes:
      parseDockerSize(listed ?? '') ?? (typeof document.Size === 'number' ? document.Size : null),
    architecture: dockerText(document.Architecture) || null,
    os: dockerText(document.Os) || null,
    layers: dockerJsonRows(lines, '@h ').map((layer) => ({
      createdBy: dockerText(layer.CreatedBy),
      sizeBytes: parseDockerSize(dockerText(layer.Size)),
      createdAt: parseDockerTime(layer.CreatedAt)
    })),
    containers: parseDockerContainerUses(lines)
      .filter((use) => use.imageId !== null && sameDockerId(use.imageId, id))
      .map(containerRef)
  }
}

function parseVolumeDetails(document: DockerJsonRow, lines: string[]): MachineDockerVolumeDetails {
  const name = dockerText(document.Name)
  return {
    kind: 'volume',
    name,
    driver: dockerText(document.Driver),
    mountpoint: dockerText(document.Mountpoint),
    scope: dockerText(document.Scope) || null,
    createdAt: parseDockerTime(document.CreatedAt),
    labels: textMap(document.Labels),
    options: textMap(document.Options),
    containers: parseDockerContainerUses(lines).flatMap((use) => {
      const mount = use.mounts.find((candidate) => candidate.volume === name)
      return mount
        ? [{ ...containerRef(use), destination: mount.destination, readOnly: mount.readOnly }]
        : []
    })
  }
}

/** Reads what a details script printed: the object's `inspect` document, then who uses it. */
export function parseDockerDetails(
  kind: MachineDockerDetailKind,
  output: string
): MachineDockerDetails | null {
  const lines = output.split(/\r?\n/)
  const [document] = dockerJsonRows(lines, '@o ')
  if (!document) {
    return null
  }
  switch (kind) {
    case 'container':
      return parseContainerDetails(document)
    case 'image':
      return parseImageDetails(document, lines)
    case 'volume':
      return parseVolumeDetails(document, lines)
  }
}

export async function readMachineDockerDetails(
  connection: MachineConnection,
  target: MachineDockerDetailTarget
): Promise<MachineDockerDetails> {
  const script = SCRIPTS[target.kind]
  if (!script || !DOCKER_NAME.test(target.id)) {
    throw new Error('Unknown Docker object')
  }
  const result = await runMachineHostScript(connection, script(quotePosixShell(target.id)), {
    timeoutMs: DETAILS_TIMEOUT_MS
  })
  const details = result.exitCode === 0 ? parseDockerDetails(target.kind, result.stdout) : null
  if (!details) {
    throw dockerExecError(target.kind, result)
  }
  return details
}
