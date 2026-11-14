import { rm } from 'node:fs/promises'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { MACHINE_HOST_SUBSCRIPTION_PREFIX } from '../../../../../shared/machines/machine-host-limits'
import type { MachineHostStreamEvent } from '../../../../../shared/machines/machine-host-wire'
import { isAllowedDownloadUrl } from '../../../../machines/filesystem/machine-filesystem'
import { machineHostFileSystem, requireHostPath } from './machine-host-file-io'

// fs.watch fires per write; one change per folder per window is all the desktop needs to relist.
const WATCH_COALESCE_MS = 200
const PROGRESS_EMIT_MS = 250

export type MachineHostSubscriptions = Pick<
  OrcaRuntimeService,
  'registerSubscriptionCleanup' | 'cleanupSubscription' | 'cleanupSubscriptionAndWait'
>

export type StreamContext = {
  runtime: MachineHostSubscriptions
  connectionId?: string
  signal?: AbortSignal
}

export type Emit = (event: MachineHostStreamEvent) => void

let subscriptionSeq = 0

export function nextSubscriptionId(kind: string, connectionId: string | undefined): string {
  return `${MACHINE_HOST_SUBSCRIPTION_PREFIX}${kind}-${connectionId ?? 'inproc'}-${++subscriptionSeq}`
}

export async function runMachineHostWatch(
  dirs: readonly string[],
  ctx: StreamContext,
  emit: Emit
): Promise<void> {
  const subscriptionId = nextSubscriptionId('watch', ctx.connectionId)
  const watched = dirs.map(requireHostPath)
  await new Promise<void>((resolve) => {
    let stop: (() => void) | null = null
    let ended = false
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const pending = new Set<string>()
    const flush = (): void => {
      flushTimer = null
      for (const dir of pending) {
        emit({ type: 'change', dir })
      }
      pending.clear()
    }
    const end = async (): Promise<void> => {
      if (ended) {
        return
      }
      ended = true
      ctx.signal?.removeEventListener('abort', onAbort)
      if (flushTimer) {
        clearTimeout(flushTimer)
      }
      stop?.()
      emit({ type: 'end' })
      resolve()
    }
    function onAbort(): void {
      ctx.runtime.cleanupSubscription(subscriptionId)
    }
    ctx.runtime.registerSubscriptionCleanup(subscriptionId, end, ctx.connectionId)
    ctx.signal?.addEventListener('abort', onAbort, { once: true })
    emit({ type: 'starting', subscriptionId })
    void machineHostFileSystem
      .watch(watched, (dir) => {
        pending.add(dir)
        flushTimer ??= setTimeout(flush, WATCH_COALESCE_MS)
      })
      .then((unwatch) => {
        if (ended) {
          unwatch?.()
        } else {
          stop = unwatch
        }
      })
    if (ctx.signal?.aborted) {
      onAbort()
    }
  })
}

export async function runMachineHostUrlDownload(
  url: string,
  destination: string,
  ctx: StreamContext,
  emit: Emit
): Promise<void> {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error('Only http and https URLs can be downloaded')
  }
  const target = requireHostPath(destination)
  const subscriptionId = nextSubscriptionId('download', ctx.connectionId)
  const controller = new AbortController()
  const onAbort = (): void => ctx.runtime.cleanupSubscription(subscriptionId)
  ctx.runtime.registerSubscriptionCleanup(
    subscriptionId,
    async () => controller.abort(),
    ctx.connectionId
  )
  ctx.signal?.addEventListener('abort', onAbort, { once: true })
  emit({ type: 'starting', subscriptionId })
  let transferred = 0
  let total: number | null = null
  let lastEmitAt = 0
  try {
    if (ctx.signal?.aborted) {
      controller.abort()
    }
    await machineHostFileSystem.downloadUrl(
      url,
      target,
      (bytes, size) => {
        transferred = bytes
        total = size
        const now = Date.now()
        if (now - lastEmitAt >= PROGRESS_EMIT_MS) {
          lastEmitAt = now
          emit({ type: 'progress', transferred, total })
        }
      },
      controller.signal
    )
    emit({ type: 'done', transferred, total })
  } catch (error) {
    await rm(target, { force: true }).catch(() => {})
    emit(
      controller.signal.aborted
        ? { type: 'cancelled' }
        : { type: 'error', message: error instanceof Error ? error.message : String(error) }
    )
  } finally {
    ctx.signal?.removeEventListener('abort', onAbort)
    ctx.runtime.cleanupSubscription(subscriptionId)
  }
}

export async function cancelMachineHostStream(
  runtime: MachineHostSubscriptions,
  subscriptionId: string
): Promise<{ cancelled: boolean }> {
  if (!subscriptionId.startsWith(MACHINE_HOST_SUBSCRIPTION_PREFIX)) {
    throw new Error('Not a machine stream')
  }
  await runtime.cleanupSubscriptionAndWait(subscriptionId)
  return { cancelled: true }
}
