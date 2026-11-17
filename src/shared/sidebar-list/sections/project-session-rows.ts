import type { HostSectionRow } from '../hosts/host-section-rows'

export function projectSessionsRowKey(headerKey: string): string {
  return `project-sessions:${headerKey}`
}

/**
 * Adds a sessions row under each unfolded project header in `headerKeys`, ahead of its workspaces.
 * A header repeated per host gets the row once, under its first copy.
 */
export function withProjectSessionRows(
  rows: readonly HostSectionRow[],
  headerKeys: ReadonlySet<string>,
  collapsedGroups: ReadonlySet<string>
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
      groupDepth: (row.projectGroupDepth ?? 0) + 1
    })
  }
  return result
}
