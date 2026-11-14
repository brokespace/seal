import type { SealProvider } from './seal-accounts-config'
import type { SealSessionSwapDelivery, SealSwapEvent } from './seal-accounts-status'
import type { SealFleetOverview } from './seal-fleet-overview'

/** One account switch: either the account new sessions start on, or one running session. */
export type SealSwapHistoryRow = {
  id: string
  at: number
  provider: SealProvider
  /** Null when nothing was selected before. */
  fromLabel: string | null
  toLabel: string
  reason: SealSwapEvent['reason']
  /** `launch`: the account new sessions start on moved. `session`: a running session moved. */
  scope: 'launch' | 'session'
  /** The project of the session that moved. */
  project: string | null
  delivery: SealSessionSwapDelivery | null
  note: string | null
  machineLabel: string
}

/** Every switch across the fleet, newest first. */
export function buildSealSwapHistory(
  overview: Pick<SealFleetOverview, 'swaps' | 'sessions' | 'groups'>,
  limit = 30
): SealSwapHistoryRow[] {
  const accounts = [...overview.groups.claude, ...overview.groups.codex, ...overview.groups.apiKeys]
  const labelOf = (key: string): string =>
    accounts.find((account) => account.key === key)?.candidate.label ?? key
  const rows: SealSwapHistoryRow[] = overview.swaps.map((swap) => ({
    id: `launch:${swap.machineId}:${swap.provider}:${swap.at}`,
    at: swap.at,
    provider: swap.provider,
    fromLabel: swap.from ? labelOf(swap.from) : null,
    toLabel: swap.toLabel,
    reason: swap.reason,
    scope: 'launch',
    project: null,
    delivery: null,
    note: null,
    machineLabel: swap.machineLabel
  }))
  for (const session of overview.sessions) {
    for (const entry of session.history ?? []) {
      rows.push({
        id: `session:${session.machineId}:${session.id}:${entry.at}`,
        at: entry.at,
        provider: session.provider,
        fromLabel: entry.fromLabel,
        toLabel: entry.toLabel,
        reason: entry.reason,
        scope: 'session',
        project: session.projectLabel,
        delivery: entry.delivery,
        note: entry.note ?? null,
        machineLabel: session.machineLabel
      })
    }
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}
