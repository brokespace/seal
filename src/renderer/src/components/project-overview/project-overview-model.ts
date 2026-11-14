import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type {
  GitConflictOperation,
  GitStatusResult
} from '../../../../shared/git/status/git-status-types'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { getRepoHostIdentity } from '../../../../shared/repo-host-identity'
import type { Repo } from '../../../../shared/repo-types'
import { createHostScopedRepoOf } from '../../../../shared/sidebar-list/feed/sidebar-feed-index'
import { getSidebarLineageChildren } from '../../../../shared/sidebar-list/lineage/pinned-section-worktrees'
import type { SidebarLineageParentIdentities } from '../../../../shared/sidebar-list/lineage/worktree-lineage-projection'
import { orderMainWorktreeFirst } from '../../../../shared/sidebar-list/sections/section-order'
import {
  rankWorktreesForSort,
  type SmartSortSources
} from '../../../../shared/sidebar-list/sorting/smart-sort'
import type { WorkspaceSortBy } from '../../../../shared/workspace-view/workspace-row-sort'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { buildWorktreeOccurrencePlan } from '../../../../shared/worktree-occurrence-plan'
import type { LiveSessionLink } from '../live-sessions/links/live-session-links'

type ProjectTarget = { repoId: string; hostId: string }

/** The registration the page is about: the target's machine, else whichever machine still holds the project. */
export function resolveProjectOverviewRepo(
  repos: readonly Repo[],
  target: ProjectTarget | null
): Repo | null {
  if (!target) {
    return null
  }
  const registrations = projectRegistrations(repos, target.repoId)
  return (
    registrations.find((repo) => getRepoExecutionHostId(repo) === target.hostId) ??
    registrations[0] ??
    null
  )
}

/** Every machine's registration of one project; the same repo id may be checked out on several. */
export function projectRegistrations(repos: readonly Repo[], repoId: string): Repo[] {
  return repos.filter((repo) => repo.id === repoId)
}

function registrationWorktrees(
  worktrees: readonly Worktree[] | undefined,
  repo: Repo,
  repos: readonly Repo[],
  repoMap: Map<string, Repo>
): Worktree[] {
  const repoOf = createHostScopedRepoOf(repos, repoMap)
  const identity = getRepoHostIdentity(repo)
  return (worktrees ?? []).filter((worktree) => {
    const owner = repoOf(worktree)
    return !worktree.isArchived && owner !== undefined && getRepoHostIdentity(owner) === identity
  })
}

/** How the sidebar ranks workspaces right now: its sort mode and what Smart reads. */
export type ProjectWorktreeRanking = {
  sortBy: WorkspaceSortBy
  sources: SmartSortSources
  now: number
}

/** The sidebar's ranking of a registration's workspaces, by host identity. */
export function rankProjectWorktrees(
  worktrees: readonly Worktree[] | undefined,
  repo: Repo,
  repos: readonly Repo[],
  ranking: ProjectWorktreeRanking
): string[] {
  const repoMap = new Map(repos.map((item) => [item.id, item]))
  return rankWorktreesForSort({
    worktrees: registrationWorktrees(worktrees, repo, repos, repoMap),
    sortBy: ranking.sortBy,
    latched: false,
    repoMap,
    now: ranking.now,
    sources: ranking.sources
  }).sorted.map(getWorktreeHostIdentity)
}

export type ProjectWorktreeOrder = {
  sortBy: WorkspaceSortBy
  /** `rankProjectWorktrees`, kept until the sidebar ranks again so both lists move together. */
  ranked: readonly string[]
  lineageById: Readonly<Record<string, WorktreeLineage>>
  lineageParents?: SidebarLineageParentIdentities
}

const PROJECT_SECTION = 'project'

/**
 * A registration's workspaces, in the sidebar's order for its project: ranked the same, the main
 * checkout first unless the order is manual, a child after its parent, an unranked row last. A
 * project on two machines keeps both machines' rows in one list, so each row goes to the
 * registration the sidebar files it under.
 */
export function projectWorktrees(
  worktrees: readonly Worktree[] | undefined,
  repo: Repo,
  repos: readonly Repo[],
  order: ProjectWorktreeOrder
): Worktree[] {
  const rank = new Map(order.ranked.map((identity, index) => [identity, index]))
  const rankOf = (worktree: Worktree): number =>
    rank.get(getWorktreeHostIdentity(worktree)) ?? order.ranked.length
  const rows = orderMainWorktreeFirst(
    registrationWorktrees(
      worktrees,
      repo,
      repos,
      new Map(repos.map((item) => [item.id, item]))
    ).sort((a, b) => rankOf(a) - rankOf(b)),
    order.sortBy
  )
  const plan = buildWorktreeOccurrencePlan({
    rows,
    identityOf: getWorktreeHostIdentity,
    childrenByParentIdentity: getSidebarLineageChildren(
      rows,
      order.lineageById,
      // Every machine's rows, as in the sidebar: a twin elsewhere can make a parent ambiguous.
      new Map((worktrees ?? []).map((worktree) => [getWorktreeHostIdentity(worktree), worktree])),
      [],
      order.lineageParents
    ),
    // The page has no Pinned section: a pinned workspace stays in its place.
    isPinned: () => false,
    duplicatePinned: false,
    sectionsOf: ({ natural }) => [{ key: PROJECT_SECTION, items: natural }]
  })
  return (plan.bySection.get(PROJECT_SECTION) ?? []).map((occurrence) => occurrence.row)
}

/** The sessions Seal links to one of the project's workspaces, on any machine. */
export function projectLiveSessions(
  sessions: readonly LiveSession[],
  links: ReadonlyMap<string, LiveSessionLink>,
  repoId: string
): LiveSession[] {
  return sessions.filter((session) => links.get(session.id)?.repoId === repoId)
}

export type GitChangeSummary = {
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  /** Distinct paths; a file staged and then edited again counts once. */
  files: number
  /** Lines added and removed across the entries git could count. */
  added: number
  removed: number
  /** Null when the branch tracks nothing: 0/0 would wrongly read as in sync. */
  upstream: { name: string | null; ahead: number; behind: number } | null
  conflictOperation: GitConflictOperation | null
}

/** What a workspace's `git status` amounts to, for a one-line summary. */
export function summarizeGitChanges(status: GitStatusResult): GitChangeSummary {
  const summary: GitChangeSummary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    files: 0,
    added: 0,
    removed: 0,
    upstream: status.upstreamStatus?.hasUpstream
      ? {
          name: status.upstreamStatus.upstreamName ?? null,
          ahead: status.upstreamStatus.ahead,
          behind: status.upstreamStatus.behind
        }
      : null,
    conflictOperation: status.conflictOperation === 'unknown' ? null : status.conflictOperation
  }
  const paths = new Set<string>()
  for (const entry of status.entries) {
    paths.add(entry.path)
    summary.added += entry.added ?? 0
    summary.removed += entry.removed ?? 0
    if (entry.conflictKind && entry.conflictStatus !== 'resolved_locally') {
      summary.conflicted += 1
    } else {
      summary[entry.area] += 1
    }
  }
  summary.files = paths.size
  return summary
}

export function isCleanGitChangeSummary(summary: GitChangeSummary): boolean {
  return (
    summary.files === 0 &&
    summary.conflictOperation === null &&
    (summary.upstream === null || (summary.upstream.ahead === 0 && summary.upstream.behind === 0))
  )
}

export type UsageBreakdownRow = {
  key: string
  sessions: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number | null
}

export type ProjectUsageTotals = {
  sessions: number
  inputTokens: number
  outputTokens: number
  /** Null when no row carried a price. */
  estimatedCostUsd: number | null
}

/**
 * One provider's usage for a project: the rows attributed to its workspaces. The scanners key a
 * row `worktree:<worktreeId>` and a worktree id starts with its repo id.
 */
export function sumProjectUsage(
  rows: readonly UsageBreakdownRow[],
  repoId: string
): ProjectUsageTotals | null {
  const prefix = `worktree:${repoId}::`
  const mine = rows.filter((row) => row.key.startsWith(prefix))
  if (mine.length === 0) {
    return null
  }
  const totals: ProjectUsageTotals = {
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: null
  }
  for (const row of mine) {
    totals.sessions += row.sessions
    totals.inputTokens += row.inputTokens
    totals.outputTokens += row.outputTokens
    if (row.estimatedCostUsd !== null) {
      totals.estimatedCostUsd = (totals.estimatedCostUsd ?? 0) + row.estimatedCostUsd
    }
  }
  return totals
}

const README_NAMES = ['readme.md', 'readme.markdown', 'readme.mdx', 'readme', 'readme.txt']

/** The README among a folder's entries, preferring Markdown, whatever its capitalisation. */
export function findReadmeName(names: readonly string[]): string | null {
  for (const wanted of README_NAMES) {
    const found = names.find((name) => name.toLowerCase() === wanted)
    if (found) {
      return found
    }
  }
  return null
}
