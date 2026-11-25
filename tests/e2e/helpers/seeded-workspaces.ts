// Workspaces a spec adds to the fixture's seeded repo, for sessions to run in.

import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'

export type SeedWorkspace = { id: string; path: string; name: string }

/** Adds workspaces (git worktrees) to the app's first project, the fixture's seeded repo. */
export async function addSeedWorkspaces(page: Page, count: number): Promise<SeedWorkspace[]> {
  return page.evaluate(
    async ({ count, prefix }) => {
      const state = window.__store!.getState()
      const repoId = state.repos[0].id
      const created: { id: string; path: string; name: string }[] = []
      for (let index = 1; index <= count; index++) {
        const name = `${prefix}-${index}`
        const { worktree } = await state.createWorktree(repoId, name, undefined, 'skip')
        created.push({ id: worktree.id, path: worktree.path, name: worktree.displayName })
      }
      await state.fetchWorktrees(repoId)
      return created
    },
    { count, prefix: `seed-${randomUUID().slice(0, 8)}` }
  )
}

/** The seeded repo outlives the test: remove what `addSeedWorkspaces` added. */
export async function removeSeedWorkspaces(
  page: Page,
  workspaces: readonly SeedWorkspace[]
): Promise<void> {
  const ids = workspaces.map((workspace) => workspace.id)
  await page.evaluate(async (ids) => {
    const state = window.__store!.getState()
    for (const id of ids) {
      const executionHostId = state.getKnownWorktreeById(id)?.hostId ?? null
      await state.removeWorktree({ id, executionHostId }, true)
    }
  }, ids)
}
