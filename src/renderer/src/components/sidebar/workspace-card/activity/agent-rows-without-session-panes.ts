import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { applyAgentRowLineage } from '@/components/dashboard/rows/agent-row-lineage'

/**
 * A card's inline rows cover pane agents that have no session record. A pane the live-session
 * registry tracks shows as the card's sessions badge and in Active agents, not here as well.
 */
export function agentRowsWithoutSessionPanes(
  rows: DashboardAgentRow[],
  sessionPaneKeys: ReadonlySet<string>
): DashboardAgentRow[] {
  if (sessionPaneKeys.size === 0 || rows.length === 0) {
    return rows
  }
  // A subagent row has no pane of its own; it goes with the session that spawned it.
  const kept = rows.filter(
    (row) =>
      !sessionPaneKeys.has(row.paneKey) &&
      !(row.activationPaneKey && sessionPaneKeys.has(row.activationPaneKey))
  )
  return kept.length === rows.length ? rows : applyAgentRowLineage(kept)
}

/** The same rule for a card's keyed root list; the input keeps its identity when nothing is left out. */
export function agentKeysWithoutSessionPanes(
  keys: readonly string[],
  sessionPaneKeys: ReadonlySet<string>,
  row: (paneKey: string) => Pick<DashboardAgentRow, 'activationPaneKey'> | undefined
): readonly string[] {
  if (sessionPaneKeys.size === 0 || keys.length === 0) {
    return keys
  }
  const kept = keys.filter((key) => {
    const activationPaneKey = row(key)?.activationPaneKey
    return (
      !sessionPaneKeys.has(key) && !(activationPaneKey && sessionPaneKeys.has(activationPaneKey))
    )
  })
  return kept.length === keys.length ? keys : kept
}
