import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { withLiveSealUsage } from '../../../../shared/seal-accounts/seal-account-usage-reading'
import type {
  SealAccountsStatus,
  SealSessionSwapEntry
} from '../../../../shared/seal-accounts/seal-accounts-status'
import { SERVE_TTL_MS } from '../../../../shared/seal-accounts/seal-usage-poll-policy'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import { onUsageReadingPushed } from './usage-reading-pushes'

const POLL_MS = 30_000
const STATUS_TIMEOUT_MS = 30_000
const MUTATION_TIMEOUT_MS = 90_000

export type SealHostSnapshot = { status: SealAccountsStatus; readAt: number }

export type SealHostState = {
  /** Null until the host has answered. */
  snapshot: SealHostSnapshot | null
  /** Why the last read failed; cleared by the next answer. */
  error: string | null
  refreshing: boolean
}

/**
 * What a status read asks of the host's usage: nothing, a re-read a person asked for, or the
 * one a view wants when it opens, which is skipped while another is still fresh.
 */
export type SealUsageRefresh = 'none' | 'requested' | 'on-open'

type HostEntry = {
  target: RuntimeClientTarget
  /** The host's answer as it arrived; what is shown also carries this device's live usage. */
  received: SealHostSnapshot | null
  state: SealHostState
  listeners: Set<() => void>
  stopPolling: (() => void) | null
  /** Newest swap seen per session, so only swaps that happen while Seal is open raise a notice. */
  seenSwaps: Map<string, number> | null
  reads: number
  /** Read numbers: an answer older than the one shown is dropped. */
  lastRead: number
  shownRead: number
  usageRefreshedAt: number
}

const NO_HOST: SealHostState = { snapshot: null, error: null, refreshing: false }

const hosts = new Map<string, HostEntry>()

export function sealHostKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `env:${target.environmentId}`
}

function notifySwap(entry: SealSessionSwapEntry): void {
  if (entry.delivery === 'live') {
    return
  }
  if (entry.delivery === 'resume') {
    toast.info(
      translate('seal.session.notice.resumed', 'Session resumed on {{value0}}', {
        value0: entry.toLabel
      }),
      {
        // A chat's note says it switches at its next message, not that it restarted.
        description:
          entry.note ??
          translate(
            'seal.session.notice.resumedDescription',
            'It could not switch logins while running, so Seal restarted it on the new account with the same conversation.'
          )
      }
    )
    return
  }
  toast.error(
    translate('seal.session.notice.failed', 'Could not move a session to {{value0}}', {
      value0: entry.toLabel
    }),
    { description: entry.note }
  )
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function publish(host: HostEntry, patch: Partial<SealHostState>): void {
  host.state = { ...host.state, ...patch }
  for (const listener of host.listeners) {
    listener()
  }
}

/**
 * This device's accounts take their usage from the store the usage popover reads, so every
 * view of them shows the popover's figures; another host's answer already carries its own.
 */
function shown(host: HostEntry, received: SealHostSnapshot): SealHostSnapshot {
  return host.target.kind === 'local'
    ? { ...received, status: withLiveSealUsage(received.status, useAppStore.getState().rateLimits) }
    : received
}

function adopt(host: HostEntry, status: SealAccountsStatus): void {
  const previous = host.seenSwaps
  const seen = new Map<string, number>()
  for (const session of status.sessions) {
    const history = session.history ?? []
    const last = history.at(-1)?.at ?? 0
    seen.set(session.id, last)
    if (previous) {
      for (const entry of history) {
        if (entry.at > (previous.get(session.id) ?? 0)) {
          notifySwap(entry)
        }
      }
    }
  }
  host.seenSwaps = seen
  host.received = { status, readAt: Date.now() }
  publish(host, { snapshot: shown(host, host.received), error: null })
}

async function load(host: HostEntry, usage: SealUsageRefresh = 'none'): Promise<void> {
  const startedAt = Date.now()
  const refreshUsage =
    usage === 'requested' ||
    (usage === 'on-open' && startedAt - host.usageRefreshedAt >= SERVE_TTL_MS)
  if (refreshUsage) {
    host.usageRefreshedAt = startedAt
  }
  const read = (host.lastRead += 1)
  host.reads += 1
  if (!host.state.refreshing) {
    publish(host, { refreshing: true })
  }
  try {
    const status = await callRuntimeRpc<SealAccountsStatus>(
      host.target,
      'seal.accounts.status',
      refreshUsage ? { refreshUsage: true } : {},
      { timeoutMs: STATUS_TIMEOUT_MS }
    )
    if (read > host.shownRead) {
      host.shownRead = read
      adopt(host, status)
    }
  } catch (caught) {
    // A host without Seal accounts (or offline) keeps what it last showed.
    publish(host, { error: errorText(caught) })
  } finally {
    host.reads -= 1
    if (host.reads === 0) {
      publish(host, { refreshing: false })
    }
  }
}

function hostFor(target: RuntimeClientTarget): HostEntry {
  const key = sealHostKey(target)
  let host = hosts.get(key)
  if (!host) {
    host = {
      target,
      received: null,
      state: NO_HOST,
      listeners: new Set(),
      stopPolling: null,
      seenSwaps: null,
      reads: 0,
      lastRead: 0,
      shownRead: 0,
      usageRefreshedAt: 0
    }
    hosts.set(key, host)
  }
  return host
}

/** Re-shows this device's accounts the moment the popover's usage changes, ahead of the host's re-read. */
function followLiveUsage(host: HostEntry): () => void {
  if (host.target.kind !== 'local') {
    return () => {}
  }
  return useAppStore.subscribe((state, previous) => {
    if (state.rateLimits !== previous.rateLimits && host.received) {
      publish(host, { snapshot: shown(host, host.received) })
    }
  })
}

/**
 * The one account status per host that every view shares: read on the first subscription, every
 * 30s, and after each usage reading.
 */
export function subscribeSealHost(target: RuntimeClientTarget, listener: () => void): () => void {
  const entry = hostFor(target)
  entry.listeners.add(listener)
  if (!entry.stopPolling) {
    void load(entry)
    const stopInterval = installWindowVisibilityInterval({
      run: () => void load(entry),
      intervalMs: POLL_MS,
      slowWhileUnfocused: true
    })
    const stopLive = followLiveUsage(entry)
    const stopFollowing = onUsageReadingPushed(() => void load(entry))
    entry.stopPolling = () => {
      stopInterval()
      stopLive()
      stopFollowing()
    }
  }
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) {
      entry.stopPolling?.()
      entry.stopPolling = null
    }
  }
}

export function sealHostState(target: RuntimeClientTarget): SealHostState {
  return hosts.get(sealHostKey(target))?.state ?? NO_HOST
}

export function sealHostSnapshot(target: RuntimeClientTarget): SealHostSnapshot | null {
  return sealHostState(target).snapshot
}

/** Re-reads a host's status for every view of it, optionally asking it for fresh usage first. */
export function refreshSealHost(
  target: RuntimeClientTarget,
  usage: SealUsageRefresh = 'none'
): Promise<void> {
  return load(hostFor(target), usage)
}

function isStatus(value: unknown): value is SealAccountsStatus {
  return typeof value === 'object' && value !== null && 'providers' in value && 'sessions' in value
}

/** Mutations answer with fresh status, either bare or as `{ status }` beside their own result. */
function statusFrom(result: unknown): SealAccountsStatus | null {
  if (isStatus(result)) {
    return result
  }
  if (typeof result === 'object' && result !== null && 'status' in result) {
    return isStatus(result.status) ? result.status : null
  }
  return null
}

/** Runs a change on a host and shows every view the fresh status it answers with. */
export async function mutateSealHost(
  target: RuntimeClientTarget,
  method: string,
  params: unknown,
  failureMessage: string
): Promise<boolean> {
  try {
    const result = await callRuntimeRpc<unknown>(target, method, params, {
      timeoutMs: MUTATION_TIMEOUT_MS
    })
    const host = hosts.get(sealHostKey(target))
    const status = statusFrom(result)
    if (host && status) {
      host.shownRead = host.lastRead += 1
      adopt(host, status)
    } else if (host) {
      await load(host)
    }
    return true
  } catch (caught) {
    toast.error(failureMessage, { description: errorText(caught) })
    return false
  }
}
