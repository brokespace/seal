import { randomUUID } from 'node:crypto'
import type {
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
import {
  forgetDockerCleanupScan,
  isDockerCleanupTarget,
  scanDockerCleanupTarget
} from './machine-docker-cleanup-scan'
import { runMachineHostScript } from './machine-host-script'

const RUN_TIMEOUT_MS = 15 * 60_000
const SCAN_VALID_MS = 15 * 60_000
const MAX_REMEMBERED_SCANS = 64

type RememberedScan = { machineId: MachineId; items: PlannedCleanupItem[]; scannedAt: number }

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
      return `docker ${action.args.map(quotePosixShell).join(' ')} 2>&1 >/dev/null`
  }
}

function cleanupScript(items: readonly PlannedCleanupItem[]): string {
  return items
    .map(
      (item, index) =>
        `if out=$(${removalCommand(item.action)}); then echo "@ok ${index}"; else printf '@fail ${index} %s\\n' "$(printf '%s' "$out" | head -n 1)"; fi`
    )
    .join('\n')
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

  async run(
    connection: MachineConnection,
    token: string,
    itemIds: readonly string[]
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
    // One use: whatever happens next, the list no longer describes the machine.
    this.scans.delete(token)
    forgetDockerCleanupScan(connection)
    const result = await runMachineHostScript(connection, cleanupScript(items), {
      timeoutMs: RUN_TIMEOUT_MS
    })
    const outcome: MachineCleanupResult = { removedIds: [], freedBytes: 0, failures: [] }
    const reported = new Set<number>()
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^@(ok|fail) (\d+)(?: (.*))?$/.exec(line)
      const item = match ? items[Number(match[2])] : undefined
      if (!match || !item) {
        continue
      }
      reported.add(Number(match[2]))
      if (match[1] === 'ok') {
        outcome.removedIds.push(item.id)
        outcome.freedBytes += item.bytes ?? 0
      } else {
        outcome.failures.push({
          id: item.id,
          label: item.label,
          message: match[3]?.trim() || 'It could not be removed.'
        })
      }
    }
    items.forEach((item, index) => {
      if (!reported.has(index)) {
        outcome.failures.push({ id: item.id, label: item.label, message: 'No result reported.' })
      }
    })
    return outcome
  }
}
