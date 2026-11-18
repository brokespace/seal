import * as z from 'zod'
import {
  HOME_WORKTREE_COUNTS_FAMILY,
  type NO_HOST_LIST_INPUT
} from '../host-screen/catalog/host-list-queries'
import { defineHostQuery } from '../query/host-query'
import type { HomeWorktreeSummary } from './home-worktree-info'
import { isWorktreeActive } from './workspace-list-sections'
import {
  readWorktreeCatalogSnapshot,
  type WorktreeCatalogSnapshot
} from './worktree-catalog-snapshot-client'

// Same pace as the workspace list's poll; agent status notices can arrive many times a second.
const HOME_WORKTREE_REFRESH_FLOOR_MS = 3000

/** What a desktop card draws from one worktree.ps read. */
export type HomeWorktreeCounts = {
  totalWorktrees: number
  activeCount: number
  // The rows this launch read: the next read's delta base, and the wide layout's host list seed. Never stored.
  catalog?: WorktreeCatalogSnapshot
}

/** Count what the list shows: archived rows are hidden, and active is the sleeping filter's rule. */
export function countHomeWorktrees(
  worktrees: readonly (Parameters<typeof isWorktreeActive>[0] & { isArchived?: boolean })[]
): Pick<HomeWorktreeCounts, 'totalWorktrees' | 'activeCount'> {
  const listed = worktrees.filter((w) => w.isArchived !== true)
  return { totalWorktrees: listed.length, activeCount: listed.filter(isWorktreeActive).length }
}

export const homeWorktreeCountsQuery = defineHostQuery<
  typeof NO_HOST_LIST_INPUT,
  HomeWorktreeCounts
>({
  family: HOME_WORKTREE_COUNTS_FAMILY,
  fetch: async (client, _target, _input, previous) => {
    const catalog = await readWorktreeCatalogSnapshot(client, previous?.catalog)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the rows stay opaque because three screens project a row differently. Home reads `status`, `sidebarStatus` and its counts through their own guards, and the `worktree-home-catalog` golden records the row it is given as `{worktreeId, displayName, repo, status}`.
    const worktrees = catalog.worktrees as HomeWorktreeSummary[]
    return { ...countHomeWorktrees(worktrees), catalog }
  },
  staleTime: HOME_WORKTREE_REFRESH_FLOOR_MS,
  // Home stays mounted for the whole launch; its cards must not empty while it sits under a screen.
  gcTime: Infinity,
  // Change notices that arrive in the background only mark it stale.
  refetchOnWindowFocus: true,
  signal: {
    events: [
      'sidebarInputsChanged',
      'worktreesChanged',
      'reposChanged',
      // The desktop Agents list changed; worktree.ps carries its verdicts.
      'agentListChanged',
      // Agent status changes on hosts without the sidebar feed (worktree.rows-changed-event.v1).
      'worktreeRowsChanged'
    ],
    floorMs: HOME_WORKTREE_REFRESH_FLOOR_MS
  },
  persist: {
    version: 1,
    dataSchema: z.object({
      totalWorktrees: z.number().int().nonnegative(),
      activeCount: z.number().int().nonnegative()
    }),
    strip: ({ totalWorktrees, activeCount }) => ({ totalWorktrees, activeCount })
  }
})
