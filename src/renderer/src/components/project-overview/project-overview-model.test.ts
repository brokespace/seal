import { describe, expect, it } from 'vitest'
import type { GitStatusResult } from '../../../../shared/git/status/git-status-types'
import type { Repo } from '../../../../shared/repo-types'
import { NO_LIVE_SMART_SORT_SOURCES } from '../../../../shared/sidebar-list/sorting/smart-sort'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { makeRepo, makeWorktree } from '../worktree-jump/worktree-jump-palette-test-fixtures'
import {
  findReadmeName,
  isCleanGitChangeSummary,
  projectLiveSessions,
  projectWorktrees,
  rankProjectWorktrees,
  resolveProjectOverviewRepo,
  sumProjectUsage,
  summarizeGitChanges
} from './project-overview-model'

const local = makeRepo()
const onGpu: Repo = { ...local, path: '/srv/repo-1', executionHostId: 'runtime:gpu' }
const other: Repo = { ...local, id: 'repo-2', displayName: 'Repo 2' }

describe('resolveProjectOverviewRepo', () => {
  it("picks the target machine's registration of a project checked out on two machines", () => {
    const repos = [local, onGpu, other]
    expect(resolveProjectOverviewRepo(repos, { repoId: 'repo-1', hostId: 'runtime:gpu' })).toBe(
      onGpu
    )
    expect(resolveProjectOverviewRepo(repos, { repoId: 'repo-1', hostId: 'local' })).toBe(local)
  })

  it('falls back to another machine that still holds the project, and to nothing when none does', () => {
    expect(resolveProjectOverviewRepo([onGpu], { repoId: 'repo-1', hostId: 'local' })).toBe(onGpu)
    expect(resolveProjectOverviewRepo([other], { repoId: 'repo-1', hostId: 'local' })).toBeNull()
    expect(resolveProjectOverviewRepo([local], null)).toBeNull()
  })
})

describe('projectWorktrees', () => {
  const ranked = (
    worktrees: Worktree[] | undefined,
    repo: Repo,
    repos: Repo[],
    sortBy: 'recent' | 'name' | 'manual'
  ): string[] =>
    rankProjectWorktrees(worktrees, repo, repos, {
      sortBy,
      sources: NO_LIVE_SMART_SORT_SOURCES,
      now: 1_000_000
    })
  const listed = (
    worktrees: Worktree[] | undefined,
    repo: Repo,
    repos: Repo[],
    sortBy: 'recent' | 'name' | 'manual',
    lineageById: Record<string, WorktreeLineage> = {}
  ): string[] =>
    projectWorktrees(worktrees, repo, repos, {
      sortBy,
      ranked: ranked(worktrees, repo, repos, sortBy),
      lineageById
    }).map((worktree) => worktree.id)

  it("lists a registration's own live workspaces", () => {
    const worktrees = [
      makeWorktree('old', 'old', { lastActivityAt: 10 }),
      makeWorktree('archived', 'archived', { isArchived: true, lastActivityAt: 99 }),
      makeWorktree('on-gpu', 'on-gpu', { hostId: 'runtime:gpu', lastActivityAt: 50 }),
      makeWorktree('recent', 'recent', { lastActivityAt: 30 }),
      makeWorktree('main', 'main', { isMainWorktree: true, lastActivityAt: 1 })
    ]
    const repos = [local, onGpu]
    expect(listed(worktrees, local, repos, 'recent')).toEqual(['main', 'recent', 'old'])
    expect(listed(worktrees, onGpu, repos, 'recent')).toEqual(['on-gpu'])
    // A project that lives only on a remote machine owns the rows that name no machine.
    expect(listed(worktrees, onGpu, [onGpu], 'recent')).toEqual(['main', 'on-gpu', 'recent', 'old'])
    expect(listed(undefined, local, repos, 'recent')).toEqual([])
  })

  it("follows the sidebar's sort mode instead of always ranking by recency", () => {
    const worktrees = [
      makeWorktree('ws-10', 'ws-10', { lastActivityAt: 90, manualOrder: 1 }),
      makeWorktree('ws-2', 'ws-2', { lastActivityAt: 10, manualOrder: 3 }),
      makeWorktree('main', 'main', { isMainWorktree: true, lastActivityAt: 1, manualOrder: 2 })
    ]
    expect(listed(worktrees, local, [local], 'name')).toEqual(['main', 'ws-2', 'ws-10'])
    // A hand-made order keeps the main checkout where the user put it.
    expect(listed(worktrees, local, [local], 'manual')).toEqual(['ws-2', 'main', 'ws-10'])
  })

  it('lists a child workspace right after its parent, the pair where the sidebar puts it', () => {
    const worktrees = [
      makeWorktree('alpha', 'alpha'),
      makeWorktree('bravo', 'bravo', { instanceId: 'bravo-1' }),
      makeWorktree('charlie', 'charlie'),
      makeWorktree('delta', 'delta', { instanceId: 'delta-1' })
    ]
    const childOfDelta: WorktreeLineage = {
      worktreeId: 'bravo',
      worktreeInstanceId: 'bravo-1',
      parentWorktreeId: 'delta',
      parentWorktreeInstanceId: 'delta-1',
      origin: 'manual',
      capture: { source: 'manual-action', confidence: 'explicit' },
      createdAt: 1
    }
    // By name the child ranks ahead of its parent, and the sidebar lifts the parent to it.
    expect(listed(worktrees, local, [local], 'name', { bravo: childOfDelta })).toEqual([
      'alpha',
      'delta',
      'bravo',
      'charlie'
    ])
    // A hand-made order keeps the parent's own place.
    expect(listed(worktrees, local, [local], 'manual', { bravo: childOfDelta })).toEqual([
      'alpha',
      'charlie',
      'delta',
      'bravo'
    ])
  })

  it('keeps its order through a rename until the sidebar ranks again, a new workspace last', () => {
    const before = [makeWorktree('a', 'alpha'), makeWorktree('b', 'bravo')]
    const after = [
      makeWorktree('new', 'aardvark'),
      makeWorktree('a', 'zulu'),
      makeWorktree('b', 'bravo')
    ]
    const held = projectWorktrees(after, local, [local], {
      sortBy: 'name',
      ranked: ranked(before, local, [local], 'name'),
      lineageById: {}
    })
    expect(held.map((worktree) => worktree.id)).toEqual(['a', 'b', 'new'])
    expect(listed(after, local, [local], 'name')).toEqual(['new', 'b', 'a'])
  })
})

describe('projectLiveSessions', () => {
  it("keeps the sessions linked to the project's workspaces and drops the rest", () => {
    const sessions = [
      sampleLiveSession('mine'),
      sampleLiveSession('theirs'),
      sampleLiveSession('loose')
    ]
    const links = new Map([
      ['mine', { worktreeId: 'repo-1::/a', repoId: 'repo-1', name: 'Repo 1 / a' }],
      ['theirs', { worktreeId: 'repo-2::/b', repoId: 'repo-2', name: 'Repo 2 / b' }]
    ])
    expect(projectLiveSessions(sessions, links, 'repo-1').map((session) => session.id)).toEqual([
      'mine'
    ])
  })
})

describe('summarizeGitChanges', () => {
  const status = (patch: Partial<GitStatusResult>): GitStatusResult => ({
    entries: [],
    conflictOperation: 'unknown',
    ...patch
  })

  it('counts a file once when it is staged and then edited again, and adds up its lines', () => {
    const summary = summarizeGitChanges(
      status({
        entries: [
          { path: 'a.ts', status: 'modified', area: 'staged', added: 4, removed: 1 },
          { path: 'a.ts', status: 'modified', area: 'unstaged', added: 2, removed: 3 },
          { path: 'new.ts', status: 'untracked', area: 'untracked', added: 10 },
          { path: 'logo.png', status: 'modified', area: 'unstaged' }
        ]
      })
    )
    expect(summary).toEqual({
      staged: 1,
      unstaged: 2,
      untracked: 1,
      conflicted: 0,
      files: 3,
      added: 16,
      removed: 4,
      upstream: null,
      conflictOperation: null
    })
    expect(isCleanGitChangeSummary(summary)).toBe(false)
  })

  it('counts an unresolved conflict as a conflict and a locally resolved one as a change', () => {
    const summary = summarizeGitChanges(
      status({
        conflictOperation: 'merge',
        entries: [
          {
            path: 'a.ts',
            status: 'modified',
            area: 'unstaged',
            conflictKind: 'both_modified',
            conflictStatus: 'unresolved'
          },
          {
            path: 'b.ts',
            status: 'modified',
            area: 'unstaged',
            conflictKind: 'both_modified',
            conflictStatus: 'resolved_locally'
          }
        ]
      })
    )
    expect(summary.conflicted).toBe(1)
    expect(summary.unstaged).toBe(1)
    expect(summary.conflictOperation).toBe('merge')
  })

  it('reads a branch with no upstream as untracked, not as in sync', () => {
    const untracked = summarizeGitChanges(
      status({ upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 } })
    )
    expect(untracked.upstream).toBeNull()
    expect(isCleanGitChangeSummary(untracked)).toBe(true)

    const ahead = summarizeGitChanges(
      status({
        upstreamStatus: { hasUpstream: true, upstreamName: 'origin/main', ahead: 2, behind: 0 }
      })
    )
    expect(ahead.upstream).toEqual({ name: 'origin/main', ahead: 2, behind: 0 })
    // Unpushed commits are work in flight even with a clean tree.
    expect(isCleanGitChangeSummary(ahead)).toBe(false)
  })
})

describe('sumProjectUsage', () => {
  const row = (key: string, sessions: number, cost: number | null) => ({
    key,
    sessions,
    inputTokens: sessions * 100,
    outputTokens: sessions * 10,
    estimatedCostUsd: cost
  })

  it("adds up the project's workspaces and leaves out a project whose id only starts the same", () => {
    const rows = [
      row('worktree:repo-1::/code/a', 2, 1.5),
      row('worktree:repo-1::/code/b', 1, null),
      row('worktree:repo-10::/code/c', 7, 9),
      row('cwd:/elsewhere', 3, 4)
    ]
    expect(sumProjectUsage(rows, 'repo-1')).toEqual({
      sessions: 3,
      inputTokens: 300,
      outputTokens: 30,
      estimatedCostUsd: 1.5
    })
  })

  it('has no cost when nothing was priced, and no totals when the project was never used', () => {
    expect(sumProjectUsage([row('worktree:repo-1::/a', 1, null)], 'repo-1')?.estimatedCostUsd).toBe(
      null
    )
    expect(sumProjectUsage([row('worktree:repo-2::/a', 1, 2)], 'repo-1')).toBeNull()
  })
})

describe('findReadmeName', () => {
  it('prefers the Markdown README, whatever its capitalisation', () => {
    expect(findReadmeName(['src', 'README', 'Readme.MD', 'package.json'])).toBe('Readme.MD')
    expect(findReadmeName(['README.txt', 'readme'])).toBe('readme')
    expect(findReadmeName(['src', 'README.md.bak'])).toBeNull()
  })
})
