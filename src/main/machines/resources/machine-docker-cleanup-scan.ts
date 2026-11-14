import type { MachineCleanupTargetId } from '../../../shared/machines/machine-resource-types'
import type { MachineConnection } from '../connection/machine-connection'
import type { MachineCleanupPlan, PlannedCleanupItem } from './machine-cleanup-plan'
import { parseDockerSize } from './machine-docker-containers'
import { runMachineHostScript } from './machine-host-script'

const SCAN_TIMEOUT_MS = 3 * 60_000
/** `docker system df` is slow on a busy daemon; the four Docker rows share one answer. */
const SHARE_SCAN_MS = 20_000
const DOCKER_NAME = /^[A-Za-z0-9][\w./:@-]*$/

export type MachineDockerCleanupTarget = Extract<
  MachineCleanupTargetId,
  'docker-images' | 'docker-containers' | 'docker-volumes' | 'docker-build-cache'
>

export function isDockerCleanupTarget(
  target: MachineCleanupTargetId
): target is MachineDockerCleanupTarget {
  return target.startsWith('docker-')
}

// Build-cache records can run to thousands, so only their `docker system df` total is read.
export const DOCKER_CLEANUP_SCAN_SCRIPT = `
command -v docker >/dev/null 2>&1 || { echo "@missing"; return 0; }
if ! summary=$(docker system df --format '@d\t{{.Type}}\t{{.Reclaimable}}' 2>&1); then
  printf '@unreachable %s\\n' "$(printf '%s' "$summary" | head -n 1)"
  return 0
fi
echo "@ready"
printf '%s\\n' "$summary"
docker system df -v --format '{{range .Images}}@i\t{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Containers}}\t{{.UniqueSize}}
{{end}}{{range .Containers}}@c\t{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Size}}
{{end}}{{range .Volumes}}@v\t{{.Name}}\t{{.Links}}\t{{.Size}}
{{end}}' 2>/dev/null
`

type DockerCleanupPlans = Record<MachineDockerCleanupTarget, MachineCleanupPlan>

function emptyPlans(unavailable: string | null): DockerCleanupPlans {
  const plan = (): MachineCleanupPlan => ({ items: [], omittedCount: 0, unavailable })
  return {
    'docker-images': plan(),
    'docker-containers': plan(),
    'docker-volumes': plan(),
    'docker-build-cache': plan()
  }
}

export function parseDockerCleanupScan(output: string): DockerCleanupPlans {
  const lines = output.split(/\r?\n/)
  if (lines.includes('@missing')) {
    return emptyPlans('Docker is not installed on this machine.')
  }
  const unreachable = lines.find((line) => line.startsWith('@unreachable'))
  if (unreachable || !lines.includes('@ready')) {
    return emptyPlans(unreachable?.slice('@unreachable'.length).trim() || 'Docker did not answer.')
  }
  const plans = emptyPlans(null)
  const add = (
    target: MachineDockerCleanupTarget,
    item: Omit<PlannedCleanupItem, 'id' | 'modifiedAt' | 'preselected'>
  ): void => {
    const items = plans[target].items
    items.push({
      ...item,
      id: `${target}:${items.length}`,
      modifiedAt: null,
      preselected: target === 'docker-build-cache'
    })
  }
  for (const line of lines) {
    const fields = line.split('\t')
    if (fields[0] === '@i' && fields[4] === '0') {
      const [, id, repository, tag, , size] = fields
      const tagged = repository !== '<none>' && tag !== '<none>'
      const reference = tagged ? `${repository}:${tag}` : id
      if (DOCKER_NAME.test(reference)) {
        add('docker-images', {
          label: tagged ? reference : id.replace(/^sha256:/, '').slice(0, 12),
          group: null,
          bytes: parseDockerSize(size ?? ''),
          action: { kind: 'docker', args: ['image', 'rm', reference] }
        })
      }
    } else if (fields[0] === '@c' && ['exited', 'created', 'dead'].includes(fields[4])) {
      const [, id, name, image, state, size] = fields
      if (DOCKER_NAME.test(id)) {
        add('docker-containers', {
          label: name || id.slice(0, 12),
          group: `${image} · ${state}`,
          bytes: parseDockerSize(size ?? ''),
          action: { kind: 'docker', args: ['container', 'rm', id] }
        })
      }
    } else if (fields[0] === '@v' && fields[2] === '0') {
      const [, name, , size] = fields
      if (DOCKER_NAME.test(name)) {
        add('docker-volumes', {
          label: name,
          group: null,
          bytes: parseDockerSize(size ?? ''),
          action: { kind: 'docker', args: ['volume', 'rm', name] }
        })
      }
    } else if (fields[0] === '@d' && fields[1] === 'Build Cache') {
      const bytes = parseDockerSize(fields[2] ?? '')
      if (bytes && bytes > 0) {
        add('docker-build-cache', {
          label: 'docker builder prune --all',
          group: null,
          bytes,
          action: { kind: 'docker', args: ['builder', 'prune', '--all', '--force'] }
        })
      }
    }
  }
  return plans
}

const shared = new Map<string, { at: number; plans: Promise<DockerCleanupPlans> }>()

export function forgetDockerCleanupScan(connection: MachineConnection): void {
  shared.delete(connection.machineId)
}

export async function scanDockerCleanupTarget(
  connection: MachineConnection,
  target: MachineDockerCleanupTarget
): Promise<MachineCleanupPlan> {
  const cached = shared.get(connection.machineId)
  if (cached && Date.now() - cached.at < SHARE_SCAN_MS) {
    return (await cached.plans)[target]
  }
  const plans = runMachineHostScript(connection, DOCKER_CLEANUP_SCAN_SCRIPT, {
    timeoutMs: SCAN_TIMEOUT_MS
  }).then((result) => parseDockerCleanupScan(result.stdout))
  shared.set(connection.machineId, { at: Date.now(), plans })
  plans.catch(() => shared.delete(connection.machineId))
  return (await plans)[target]
}
