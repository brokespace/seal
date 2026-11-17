import type { HostSectionRow } from '../hosts/host-section-rows'

export function projectSessionsRowKey(headerKey: string): string {
  return `project-sessions:${headerKey}`
}

/** A header the sessions bring to the list: a project it has no workspace of, or none for sessions with no folder. */
export type SessionsOnlyHeader = {
  /** Also what folds it. */
  key: string
  label: string
  /** The project it names; null when the sessions have none. */
  project: string | null
  count: number
}

/**
 * Adds a sessions row under each unfolded project header in `headerKeys`, ahead of its workspaces,
 * then each of `sessionsOnly` as a header of its own after the last workspace. A header repeated
 * per host gets the row once, under its first copy.
 */
export function withProjectSessionRows(
  rows: readonly HostSectionRow[],
  headerKeys: ReadonlySet<string>,
  collapsedGroups: ReadonlySet<string>,
  sessionsOnly: readonly SessionsOnlyHeader[] = []
): HostSectionRow[] {
  const placed = new Set<string>()
  const result: HostSectionRow[] = []
  for (const row of rows) {
    result.push(row)
    if (
      row.type !== 'header' ||
      !headerKeys.has(row.key) ||
      placed.has(row.key) ||
      collapsedGroups.has(row.collapseKey ?? row.key)
    ) {
      continue
    }
    placed.add(row.key)
    result.push({
      type: 'project-sessions',
      key: projectSessionsRowKey(row.key),
      headerKey: row.key,
      project: row.label ?? null,
      groupDepth: (row.projectGroupDepth ?? 0) + 1
    })
  }
  for (const { key, label, project, count } of sessionsOnly) {
    result.push({
      type: 'header',
      key,
      label,
      count,
      icon: { kind: 'project' },
      sessionsOnly: true
    })
    if (!collapsedGroups.has(key)) {
      result.push({
        type: 'project-sessions',
        key: projectSessionsRowKey(key),
        headerKey: key,
        project,
        groupDepth: 1
      })
    }
  }
  return result
}
