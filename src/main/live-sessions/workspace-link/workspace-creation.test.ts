import { expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { WorkspaceCreation } from './workspace-creation'

it('keeps both worktrees when sessions in two of them list them at once', async () => {
  let repo: Repo = {
    id: 'r1',
    path: '/home/me/repo',
    displayName: 'repo',
    badgeColor: '',
    addedAt: 0,
    kind: 'git'
  }
  const creation = new WorkspaceCreation({
    runtime: {
      addRepo: vi.fn(),
      removeProject: vi.fn(),
      // Like the runtime: the write lands a moment after the call.
      updateRepo: async (_selector, updates) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        repo = { ...repo, importedExternalWorktreePaths: updates.importedExternalWorktreePaths }
        return repo
      }
    },
    store: { getRepos: () => [repo], updateRepo: vi.fn() }
  })

  await Promise.all([
    creation.importWorktree(repo, '/home/me/worktrees/a'),
    creation.importWorktree(repo, '/home/me/worktrees/b')
  ])

  expect(repo.importedExternalWorktreePaths).toEqual([
    '/home/me/worktrees/a',
    '/home/me/worktrees/b'
  ])
})
