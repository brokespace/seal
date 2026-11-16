import { randomUUID } from 'node:crypto'
import type { MachineDockerStorageKind } from '../../../shared/machines/machine-docker-types'
import type {
  MachineCleanupProgress,
  MachineCleanupResult,
  MachineCleanupScan,
  MachineCleanupTargetId
} from '../../../shared/machines/machine-resource-types'
import { MACHINE_CLEANUP_TARGETS } from '../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../shared/machines/machine-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../connection/machine-connection'
import type {
  MachineCleanupAction,
  MachineCleanupPlan,
  PlannedCleanupItem
} from './machine-cleanup-plan'
import { scanPathCleanupTarget } from './machine-cleanup-path-scans'
import { forgetDockerInventory } from './machine-docker-inventory'
import { parseDockerSize } from './machine-docker-output'
import {
  isDockerCleanupTarget,
  planMachineDockerRemoval,
  scanDockerCleanupTarget
} from './machine-docker-removal-plans'
import { runMachineHostScript } from './machine-host-script'

const BATCH_TIMEOUT_MS = 10 * 60_000
const SCAN_VALID_MS = 15 * 60_000
const MAX_REMEMBERED_SCANS = 64
/** A run reports about this many times, however many items it removes. */
const PROGRESS_STEPS = 20

type RememberedScan = { machineId: MachineId; items: PlannedCleanupItem[]; scannedAt: number }

// A removal prints what went wrong, or on success an optional `@freed <size>` line.
const DOCKER_REMOVAL_FUNCTIONS = `
seal_docker_image_rm() {
  seal_removed=$(docker image rm "$@" 2>&1) || { printf '%s\\n' "$seal_removed"; return 1; }
  printf '%s\\n' "$seal_removed" | grep -q '^Deleted:' || echo '@freed 0B'
}
seal_docker_cache_prune() {
  if [ -n "$1" ]; then seal_pruned=$(docker builder prune --all --force --filter "id=$1" 2>&1)
  else seal_pruned=$(docker builder prune --all --force 2>&1); fi || { printf '%s\\n' "$seal_pruned"; return 1; }
  if [ -n "$1" ] && ! printf '%s\\n' "$seal_pruned" | grep -q "^$1"; then
    echo 'Docker kept this record: another record builds on it, or it is already gone.'
    return 1
  fi
  printf '%s\\n' "$seal_pruned" | sed -n 's/^Total[^:]*:[[:space:]]*/@freed /p'
}
`

function dockerCommand(args: readonly string[]): string {
  return `docker ${args.map(quotePosixShell).join(' ')} 2>&1 >/dev/null`
}

function removalCommand(action: MachineCleanupAction): string {
  switch (action.kind) {
    case 'remove':
      return `rm -rf -- ${quotePosixShell(action.path)} 2>&1 && [ ! -e ${quotePosixShell(action.path)} ]`
    case 'empty':
      return action.paths
        .map(
          (path) =>
            `find ${quotePosixShell(path)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>&1`
        )
        .join(' && ')
    case 'docker':
      return dockerCommand(action.args)
    case 'docker-sequence':
      return action.commands.map(dockerCommand).join(' && ')
    case 'docker-image':
      return `seal_docker_image_rm ${action.force ? '--force ' : ''}${action.targets.map(quotePosixShell).join(' ')}`
    case 'docker-build-cache':
      return `seal_docker_cache_prune ${quotePosixShell(action.record ?? '')}`
  }
}

function cleanupScript(items: readonly PlannedCleanupItem[]): string {
  const removals = items.map(
    (item, index) =>
      `if out=$(${removalCommand(item.action)}); then echo "@ok ${index} $(printf '%s\\n' "$out" | sed -n 's/^@freed //p' | head -n 1)"; else printf '@fail ${index} %s\\n' "$(printf '%s\\n' "$out" | sed -n '/[^[:space:]]/{p;q;}')"; fi`
  )
  return [DOCKER_REMOVAL_FUNCTIONS, ...removals].join('\n')
}

/**
 * Scans what a cleanup would remove, then removes only items from a scan it produced itself:
 * a cleanup names a scan token and item ids, never paths or commands.
 */
export class MachineCleanupRunner {
  private readonly scans = new Map<string, RememberedScan>()

  constructor(private readonly now: () => number = Date.now) {}

  async scan(
    connection: MachineConnection,
    target: MachineCleanupTargetId
  ): Promise<MachineCleanupScan> {
    if (!MACHINE_CLEANUP_TARGETS.includes(target)) {
      throw new Error('Unknown cleanup target')
    }
    const plan: MachineCleanupPlan = isDockerCleanupTarget(target)
      ? await scanDockerCleanupTarget(connection, target)
      : await scanPathCleanupTarget(connection, target)
    return this.remember(connection, target, plan)
  }

  /** Lists what removing the picked Docker objects would do, as a scan `run` accepts. */
  async plan(
    connection: MachineConnection,
    kind: MachineDockerStorageKind,
    keys: readonly string[]
  ): Promise<MachineCleanupScan> {
    const { target, plan } = await planMachineDockerRemoval(connection, kind, keys)
    return this.remember(connection, target, plan)
  }

  private remember(
    connection: MachineConnection,
    target: MachineCleanupTargetId,
    plan: MachineCleanupPlan
  ): MachineCleanupScan {
    const token = randomUUID()
    this.scans.set(token, {
      machineId: connection.machineId,
      items: plan.items,
      scannedAt: this.now()
    })
    while (this.scans.size > MAX_REMEMBERED_SCANS) {
      const oldest = this.scans.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.scans.delete(oldest)
    }
    return {
      machineId: connection.machineId,
      target,
      token,
      items: plan.items.map(({ action: _action, ...item }) => item),
      totalBytes: plan.items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      omittedCount: plan.omittedCount,
      unavailable: plan.unavailable
    }
  }

  /** Removes in batches and reports after each, so a long run shows where it is. */
  async run(
    connection: MachineConnection,
    token: string,
    itemIds: readonly string[],
    onProgress: (progress: MachineCleanupProgress) => void = () => {}
  ): Promise<MachineCleanupResult> {
    const scan = this.scans.get(token)
    if (!scan || scan.machineId !== connection.machineId) {
      throw new Error('This cleanup list is no longer current. Scan again.')
    }
    if (this.now() - scan.scannedAt > SCAN_VALID_MS) {
      this.scans.delete(token)
      throw new Error('This cleanup list is too old. Scan again.')
    }
    const wanted = new Set(itemIds)
    const items = scan.items.filter((item) => wanted.has(item.id))
    if (items.length === 0 || items.length !== wanted.size) {
      throw new Error('Pick items from the current cleanup list.')
    }
    const blocked = items.find((item) => item.blocked)
    if (blocked) {
      throw new Error(`${blocked.label} cannot be removed here. ${blocked.blocked}`)
    }
    // One use: whatever happens next, the list no longer describes the machine.
    this.scans.delete(token)
    const outcome: MachineCleanupResult = { removedIds: [], freedBytes: 0, failures: [] }
    const fail = (item: PlannedCleanupItem, message: string): void => {
      outcome.failures.push({ id: item.id, label: item.label, message })
    }
    const report = (done: number): void =>
      onProgress({
        token,
        done,
        total: items.length,
        freedBytes: outcome.freedBytes,
        failed: outcome.failures.length,
        current: items[done]?.label ?? null
      })
    const batchSize = Math.max(1, Math.ceil(items.length / PROGRESS_STEPS))
    try {
      for (let start = 0; start < items.length; start += batchSize) {
        report(start)
        const batch = items.slice(start, start + batchSize)
        let stdout: string
        try {
          stdout = (
            await runMachineHostScript(connection, cleanupScript(batch), {
              timeoutMs: BATCH_TIMEOUT_MS
            })
          ).stdout
        } catch (error) {
          // What was removed so far stays reported; nothing after a lost machine is attempted.
          const message = error instanceof Error ? error.message : String(error)
          items.slice(start).forEach((item) => fail(item, message))
          break
        }
        const reported = new Set<number>()
        for (const line of stdout.split(/\r?\n/)) {
          const match = /^@(ok|fail) (\d+)(?: (.*))?$/.exec(line)
          const item = match ? batch[Number(match[2])] : undefined
          if (!match || !item) {
            continue
          }
          reported.add(Number(match[2]))
          if (match[1] === 'ok') {
            outcome.removedIds.push(item.id)
            outcome.freedBytes += parseDockerSize(match[3] ?? '') ?? item.bytes ?? 0
          } else {
            fail(item, match[3]?.trim() || 'It could not be removed.')
          }
        }
        batch.forEach((item, index) => {
          if (!reported.has(index)) {
            fail(item, 'No result reported.')
          }
        })
      }
    } finally {
      forgetDockerInventory(connection)
    }
    report(items.length)
    return outcome
  }
}
