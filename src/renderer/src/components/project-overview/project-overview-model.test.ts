import { describe, expect, it } from 'vitest'
import type { GitStatusResult } from '../../../../shared/git/status/git-status-types'
import type { Repo } from '../../../../shared/repo-types'
import { sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { makeRepo, makeWorktree } from '../worktree-jump/worktree-jump-palette-test-fixtures'
import {
  findReadmeName,
  isCleanGitChangeSummary,
  projectLiveSessions,
  projectWorktrees,
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
  it("lists a registration's own live workspaces, main checkout first, then most recently active", () => {
    const worktrees = [
      makeWorktree('old', 'old', { lastActivityAt: 10 }),
      makeWorktree('archived', 'archived', { isArchived: true, lastActivityAt: 99 }),
      makeWorktree('on-gpu', 'on-gpu', { hostId: 'runtime:gpu', lastActivityAt: 50 }),
      makeWorktree('recent', 'recent', { lastActivityAt: 30 }),
      makeWorktree('main', 'main', { isMainWorktree: true, lastActivityAt: 1 })
    ]
    const repos = [local, onGpu]
    expect(projectWorktrees(worktrees, local, repos).map((worktree) => worktree.id)).toEqual([
      'main',
      'recent',
      'old'
    ])
    expect(projectWorktrees(worktrees, onGpu, repos).map((worktree) => worktree.id)).toEqual([
      'on-gpu'
    ])
    // A project that lives only on a remote machine owns the rows that name no machine.
    expect(projectWorktrees(worktrees, onGpu, [onGpu]).map((worktree) => worktree.id)).toEqual([
      'main',
      'on-gpu',
      'recent',
      'old'
    ])
    expect(projectWorktrees(undefined, local, repos)).toEqual([])
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
