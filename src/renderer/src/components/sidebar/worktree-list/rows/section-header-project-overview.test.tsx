// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWorktreeSectionHeaderRow } from './SectionHeader'
import { makeRepo } from '../../../worktree-jump/worktree-jump-palette-test-fixtures'
import type { GroupHeaderRow } from '../../../../../../shared/sidebar-list/row-types'
import type { SectionHeaderRowContext } from './section-header-row-context'
import type { WorktreeSidebarHeaderDrag } from '../drag/use-header-drag'

const noDrag = { state: {}, onHandlePointerDown: vi.fn() }
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a header at rest reads only these fields of the drag controller.
const headerDrag = {
  rootProjectHeaderKeys: undefined,
  canReorderRepoHeaders: false,
  canReorderProjectGroupHeaders: false,
  repoDrag: noDrag,
  projectGroupDrag: noDrag,
  rootProjectHeaderCountByOccurrenceKey: new Map(),
  rootProjectHeaderSectionEndByKey: new Map(),
  sidebarRepoHeaderIdsByBucket: new Map(),
  sidebarProjectGroupHeaderIdsByBucket: new Map(),
  repoHeaderIndexByRepoId: new Map(),
  repoHeaderBucketByRepoId: new Map(),
  projectGroupHeaderIndexByGroupId: new Map(),
  projectGroupHeaderBucketByGroupId: new Map(),
  repoHeaderSectionEndByRepoId: new Map(),
  projectGroupHeaderSectionEndByGroupId: new Map()
} as unknown as WorktreeSidebarHeaderDrag

const fold = vi.fn()
const foldAll = vi.fn()
const openOverview = vi.fn()

function renderHeader(row: GroupHeaderRow, groupBy: SectionHeaderRowContext['groupBy']): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the header under test only calls the handlers given here.
  const ctx = {
    groupBy,
    collapsedGroups: new Set<string>(),
    workspaceStatuses: [],
    projectGroups: [],
    highlightedRevealRowKey: null,
    dragOverStatus: null,
    pinDragOver: false,
    headerDrag,
    getCachedFolderWorkspacePathStatus: () => null,
    toggleGroupWithScrollAnchor: fold,
    toggleAllProjects: foldAll,
    projectActions: {
      onOpenProjectOverview: openOverview,
      onCreateForRepo: vi.fn(),
      getWorktreeVisibilityDefaults: () => undefined
    }
  } as unknown as SectionHeaderRowContext
  render(
    <TooltipProvider>
      {renderWorktreeSectionHeaderRow({
        ctx,
        row,
        vItem: { key: row.key, index: 0, start: 0, end: 28, size: 28, lane: 0 },
        isActiveStickyHeader: false,
        hasStickyHost: false,
        hasHeaderTopSpacing: false,
        measureVirtualRowElement: () => {}
      })}
    </TooltipProvider>
  )
}

const repo = makeRepo()
const projectRow: GroupHeaderRow = {
  type: 'header',
  key: 'repo:repo-1',
  label: 'Repo 1',
  count: 2,
  icon: { kind: 'project' },
  repo
}
const pinnedRow: GroupHeaderRow = {
  type: 'header',
  key: 'pinned',
  label: 'Pinned',
  count: 1,
  icon: { kind: 'pinned' }
}

const initial = useAppStore.getInitialState()
beforeEach(() => {
  vi.stubGlobal('api', {})
  useAppStore.setState(initial, true)
  useAppStore.setState({ repos: [repo] })
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAppStore.setState(initial, true)
})

it("a project's name opens its overview and leaves the list as it is", () => {
  renderHeader(projectRow, 'repo')
  fireEvent.click(screen.getByText('Repo 1'))
  expect(openOverview).toHaveBeenCalledExactlyOnceWith(repo)
  expect(fold).not.toHaveBeenCalled()
})

it("a project's chevron folds the list and does not open the overview", () => {
  renderHeader(projectRow, 'repo')
  const chevron = screen.getByRole('button', { name: 'Collapse Repo 1' })
  expect(chevron.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(chevron)
  expect(fold).toHaveBeenCalledExactlyOnceWith('repo:repo-1')
  expect(openOverview).not.toHaveBeenCalled()

  fireEvent.click(chevron, { altKey: true })
  expect(foldAll).toHaveBeenCalledOnce()
  expect(openOverview).not.toHaveBeenCalled()
})

it('on a project header Enter opens the overview and Space folds', () => {
  renderHeader(projectRow, 'repo')
  const header = document.querySelector<HTMLElement>('[data-repo-header-id="repo-1"]')!
  fireEvent.keyDown(header, { key: 'Enter' })
  expect(openOverview).toHaveBeenCalledExactlyOnceWith(repo)
  expect(fold).not.toHaveBeenCalled()

  fireEvent.keyDown(header, { key: ' ' })
  expect(fold).toHaveBeenCalledExactlyOnceWith('repo:repo-1')
  expect(openOverview).toHaveBeenCalledOnce()
})

it('a header that is not a project still folds when clicked', () => {
  renderHeader(pinnedRow, 'none')
  fireEvent.click(screen.getByText('Pinned'))
  expect(fold).toHaveBeenCalledExactlyOnceWith('pinned')
  expect(openOverview).not.toHaveBeenCalled()
})

it("marks the header of the project whose overview is on screen, on that project's machine only", () => {
  useAppStore.getState().openProjectOverview(repo)
  renderHeader(projectRow, 'repo')
  expect(screen.getByText('Repo 1').getAttribute('aria-current')).toBe('page')

  cleanup()
  useAppStore.getState().openProjectOverview({ ...repo, executionHostId: 'runtime:gpu' })
  renderHeader(projectRow, 'repo')
  expect(screen.getByText('Repo 1').hasAttribute('aria-current')).toBe(false)
})
