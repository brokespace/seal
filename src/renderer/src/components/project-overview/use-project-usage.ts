import { sumProjectUsage, type ProjectUsageTotals } from './project-overview-model'
import { useProjectOverviewLoad, type ProjectOverviewLoad } from './use-project-overview-load'

export type ProjectUsage = {
  /** Null when that provider's usage tracking is off. */
  claude: ProjectUsageTotals | 'none' | null
  codex: ProjectUsageTotals | 'none' | null
}

const QUERY = { scope: 'all', range: '30d', kind: 'project' } as const

/** Last 30 days of Claude and Codex usage attributed to the project's workspaces on this computer. */
export function useProjectUsage(repoId: string): ProjectOverviewLoad<ProjectUsage> {
  return useProjectOverviewLoad(repoId, async () => {
    const read = async (
      api: Pick<typeof window.api.claudeUsage | typeof window.api.codexUsage, 'getScanState'> & {
        getBreakdown: (args: typeof QUERY) => Promise<Parameters<typeof sumProjectUsage>[0]>
      }
    ): Promise<ProjectUsageTotals | 'none' | null> => {
      const scan = await api.getScanState()
      if (!scan.enabled) {
        return null
      }
      return sumProjectUsage(await api.getBreakdown(QUERY), repoId) ?? 'none'
    }
    const [claude, codex] = await Promise.all([
      read(window.api.claudeUsage),
      read(window.api.codexUsage)
    ])
    return { claude, codex }
  })
}
