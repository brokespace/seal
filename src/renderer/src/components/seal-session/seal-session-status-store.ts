import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  SealAccountsStatus,
  SealSessionSwapEntry
} from '../../../../shared/seal-accounts/seal-accounts-status'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { translate } from '@/i18n/i18n'
import { onUsageReadingPushed } from './usage-reading-pushes'

const POLL_MS = 30_000

type HostEntry = {
  target: RuntimeClientTarget
  snapshot: SealHostSnapshot | null
  listeners: Set<() => void>
  stopPolling: (() => void) | null
  /** Newest swap seen per session, so only swaps that happen while Seal is open raise a notice. */
  seenSwaps: Map<string, number> | null
}

export type SealHostSnapshot = { status: SealAccountsStatus; readAt: number }

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
        description: translate(
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
  host.snapshot = { status, readAt: Date.now() }
  for (const listener of host.listeners) {
    listener()
  }
}

async function load(host: HostEntry): Promise<void> {
  try {
    adopt(
      host,
      await callRuntimeRpc<SealAccountsStatus>(
        host.target,
        'seal.accounts.status',
        {},
        {
          timeoutMs: 30_000
        }
      )
    )
  } catch {
    // A host without Seal accounts (or offline) simply shows no badges.
  }
}

/** Shares one status poll per host across every view that shows it: every 30s and after each usage reading. */
export function subscribeSealHost(target: RuntimeClientTarget, listener: () => void): () => void {
  const key = sealHostKey(target)
  let host = hosts.get(key)
  if (!host) {
    host = { target, snapshot: null, listeners: new Set(), stopPolling: null, seenSwaps: null }
    hosts.set(key, host)
  }
  const entry = host
  entry.listeners.add(listener)
  if (!entry.stopPolling) {
    void load(entry)
    const stopInterval = installWindowVisibilityInterval({
      run: () => void load(entry),
      intervalMs: POLL_MS,
      slowWhileUnfocused: true
    })
    const stopFollowing = onUsageReadingPushed(() => void load(entry))
    entry.stopPolling = () => {
      stopInterval()
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

export function sealHostSnapshot(target: RuntimeClientTarget): SealHostSnapshot | null {
  return hosts.get(sealHostKey(target))?.snapshot ?? null
}

function isStatus(value: unknown): value is SealAccountsStatus {
  return typeof value === 'object' && value !== null && 'sessions' in value
}

/** Runs a session mutation on its host and shows the fresh status it answers with. */
export async function mutateSealHost(
  target: RuntimeClientTarget,
  method: string,
  params: unknown,
  failureMessage: string
): Promise<void> {
  try {
    const result = await callRuntimeRpc<unknown>(target, method, params, { timeoutMs: 90_000 })
    const status =
      typeof result === 'object' && result !== null && 'status' in result ? result.status : result
    const host = hosts.get(sealHostKey(target))
    if (host && isStatus(status)) {
      adopt(host, status)
    } else if (host) {
      await load(host)
    }
  } catch (caught) {
    toast.error(failureMessage, {
      description: caught instanceof Error ? caught.message : String(caught)
    })
  }
}
