import { describe, expect, it } from 'vitest'
import {
  activateSplitViewChip,
  closeSplitViewChips,
  keepSplitViewChip,
  neighbourSplitViewPane,
  revealSplitViewItem,
  splitViewFocusAfterClose,
  splitViewKeysOtherThan,
  splitViewPaneKeys
} from './split-view-chip-transitions'
import type { SplitViewItem, SplitViewState, SplitViewTab } from './split-view-types'

const alpha: SplitViewItem = { kind: 'workspace', worktreeId: 'wt-alpha', hostId: null }
const beta: SplitViewItem = { kind: 'workspace', worktreeId: 'wt-beta', hostId: 'host-1' }
const chat: SplitViewItem = { kind: 'session', sessionId: 'host-1:chat' }
const docs: SplitViewItem = { kind: 'project', repoId: 'repo-docs', hostId: 'host-1' }

const ALPHA = 'workspace:wt-alpha'
const BETA = 'workspace:wt-beta'
const CHAT = 'session:host-1:chat'
const DOCS = 'project:host-1\nrepo-docs'

const alphaTab: SplitViewTab = { item: alpha, preview: false }
const betaTab: SplitViewTab = { item: beta, preview: false }
const chatTab: SplitViewTab = { item: chat, preview: false }
const docsTab: SplitViewTab = { item: docs, preview: false }

const NO_SPLIT_VIEW = { layout: null, panes: {}, focusedPaneId: null, maximizedPaneId: null }

/** left [alpha, beta] | right [chat] */
const sideBySide: SplitViewState = {
  layout: {
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', groupId: 'left' },
    second: { type: 'leaf', groupId: 'right' },
    ratio: 0.5
  },
  panes: {
    left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
    right: { tabs: [chatTab], activeKey: CHAT }
  },
  focusedPaneId: 'left',
  maximizedPaneId: null
}

/** left [alpha] | top [beta] over bottom [chat, docs] */
const threePanes: SplitViewState = {
  layout: {
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', groupId: 'left' },
    second: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', groupId: 'top' },
      second: { type: 'leaf', groupId: 'bottom' },
      ratio: 0.3
    },
    ratio: 0.6
  },
  panes: {
    left: { tabs: [alphaTab], activeKey: ALPHA },
    top: { tabs: [betaTab], activeKey: BETA },
    bottom: { tabs: [chatTab, docsTab], activeKey: CHAT }
  },
  focusedPaneId: 'left',
  maximizedPaneId: null
}

/** left [alpha, beta, docs] showing beta | right [chat] */
const threeChips: SplitViewState = {
  ...sideBySide,
  panes: {
    left: { tabs: [alphaTab, betaTab, docsTab], activeKey: BETA },
    right: { tabs: [chatTab], activeKey: CHAT }
  }
}

describe('activateSplitViewChip', () => {
  it('focuses the pane and shows the chip', () => {
    expect(activateSplitViewChip(threePanes, 'bottom', DOCS)).toEqual({
      ...threePanes,
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        top: { tabs: [betaTab], activeKey: BETA },
        bottom: { tabs: [chatTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom'
    })
  })

  it('only moves focus when no chip is named', () => {
    expect(activateSplitViewChip(sideBySide, 'right')).toEqual({
      ...sideBySide,
      focusedPaneId: 'right'
    })
  })

  it('keeps the shown chip when the named chip is not in the pane', () => {
    const next = activateSplitViewChip({ ...threeChips, focusedPaneId: 'right' }, 'left', CHAT)

    expect(next.panes.left.activeKey).toBe(BETA)
    expect(next.focusedPaneId).toBe('left')
  })

  it('returns the same state when the chip is already shown in the focused pane', () => {
    expect(activateSplitViewChip(sideBySide, 'left', ALPHA)).toBe(sideBySide)
  })

  it('shows the newly focused pane maximized while a pane is maximized', () => {
    const next = activateSplitViewChip({ ...sideBySide, maximizedPaneId: 'left' }, 'right')

    expect(next.focusedPaneId).toBe('right')
    expect(next.maximizedPaneId).toBe('right')
  })

  it('does nothing for a pane that is not in the grid', () => {
    expect(activateSplitViewChip(sideBySide, 'gone', ALPHA)).toBe(sideBySide)
  })
})

describe('revealSplitViewItem', () => {
  it('focuses the pane that already holds the item and shows it there', () => {
    expect(revealSplitViewItem(threePanes, docs)).toEqual({
      ...threePanes,
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        top: { tabs: [betaTab], activeKey: BETA },
        bottom: { tabs: [chatTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom'
    })
  })

  it('opens a new item as a shown preview chip after the kept chips of the focused pane', () => {
    expect(revealSplitViewItem(sideBySide, docs)).toEqual({
      ...sideBySide,
      panes: {
        left: { tabs: [alphaTab, betaTab, { item: docs, preview: true }], activeKey: DOCS },
        right: { tabs: [chatTab], activeKey: CHAT }
      }
    })
  })

  it("replaces the focused pane's previous preview chip in place", () => {
    const withPreview: SplitViewState = {
      ...sideBySide,
      panes: {
        left: { tabs: [{ item: alpha, preview: true }, betaTab], activeKey: BETA },
        right: { tabs: [chatTab], activeKey: CHAT }
      }
    }

    expect(revealSplitViewItem(withPreview, docs).panes).toEqual({
      left: { tabs: [{ item: docs, preview: true }, betaTab], activeKey: DOCS },
      right: { tabs: [chatTab], activeKey: CHAT }
    })
  })

  it('leaves a preview chip in another pane alone', () => {
    const previewElsewhere: SplitViewState = {
      ...sideBySide,
      panes: {
        left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
        right: { tabs: [{ item: chat, preview: true }], activeKey: CHAT }
      }
    }

    expect(revealSplitViewItem(previewElsewhere, docs).panes).toEqual({
      left: { tabs: [alphaTab, betaTab, { item: docs, preview: true }], activeKey: DOCS },
      right: { tabs: [{ item: chat, preview: true }], activeKey: CHAT }
    })
  })
})

describe('keepSplitViewChip', () => {
  const withPreviews: SplitViewState = {
    ...sideBySide,
    panes: {
      left: { tabs: [alphaTab, { item: beta, preview: true }], activeKey: BETA },
      right: { tabs: [{ item: chat, preview: true }], activeKey: CHAT }
    }
  }

  it('makes a preview chip permanent and leaves other previews as they are', () => {
    expect(keepSplitViewChip(withPreviews, BETA)).toEqual({
      ...sideBySide,
      panes: {
        left: { tabs: [alphaTab, betaTab], activeKey: BETA },
        right: { tabs: [{ item: chat, preview: true }], activeKey: CHAT }
      }
    })
  })

  it('stops the next preview from replacing the kept chip', () => {
    expect(revealSplitViewItem(keepSplitViewChip(withPreviews, BETA), docs).panes.left).toEqual({
      tabs: [alphaTab, betaTab, { item: docs, preview: true }],
      activeKey: DOCS
    })
  })

  it('returns the same state for a chip that is already kept', () => {
    expect(keepSplitViewChip(sideBySide, ALPHA)).toBe(sideBySide)
  })
})

describe('closeSplitViewChips', () => {
  it('closes a chip that is not shown and leaves the rest as they were', () => {
    expect(closeSplitViewChips(threeChips, new Set([ALPHA]))).toEqual({
      ...sideBySide,
      panes: {
        left: { tabs: [betaTab, docsTab], activeKey: BETA },
        right: { tabs: [chatTab], activeKey: CHAT }
      }
    })
  })

  it('shows the next chip of the strip when the shown chip closes', () => {
    expect(closeSplitViewChips(threeChips, new Set([BETA])).panes.left).toEqual({
      tabs: [alphaTab, docsTab],
      activeKey: DOCS
    })
  })

  it('shows the previous chip when the shown chip was the last of the strip', () => {
    const showingLast: SplitViewState = {
      ...threeChips,
      panes: { ...threeChips.panes, left: { tabs: [alphaTab, betaTab, docsTab], activeKey: DOCS } }
    }

    expect(closeSplitViewChips(showingLast, new Set([DOCS])).panes.left).toEqual({
      tabs: [alphaTab, betaTab],
      activeKey: BETA
    })
  })

  it('removes a pane whose last chip closes and lets its sibling grow into the space', () => {
    expect(closeSplitViewChips(threePanes, new Set([BETA]))).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        bottom: { tabs: [chatTab, docsTab], activeKey: CHAT }
      },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('closes a whole pane at once', () => {
    expect(closeSplitViewChips(threePanes, new Set([CHAT, DOCS]))).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'top' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        top: { tabs: [betaTab], activeKey: BETA }
      },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('keeps one pane with several chips as a grid of one', () => {
    expect(closeSplitViewChips(sideBySide, new Set([CHAT]))).toEqual({
      layout: { type: 'leaf', groupId: 'left' },
      panes: { left: { tabs: [alphaTab, betaTab], activeKey: ALPHA } },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('ends split view when one pane with one chip is left', () => {
    expect(closeSplitViewChips(sideBySide, new Set([BETA, CHAT]))).toEqual(NO_SPLIT_VIEW)
  })

  it('ends split view when every chip closes', () => {
    expect(closeSplitViewChips(sideBySide, new Set([ALPHA, BETA, CHAT]))).toEqual(NO_SPLIT_VIEW)
  })

  it('moves focus to the sibling pane when the focused pane closes', () => {
    const next = closeSplitViewChips(
      { ...threePanes, focusedPaneId: 'bottom' },
      new Set([CHAT, DOCS])
    )

    expect(next.focusedPaneId).toBe('top')
  })

  it('moves focus to the first pane of the sibling split when the focused pane closes', () => {
    expect(closeSplitViewChips(threePanes, new Set([ALPHA]))).toEqual({
      layout: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'top' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.3
      },
      panes: {
        top: { tabs: [betaTab], activeKey: BETA },
        bottom: { tabs: [chatTab, docsTab], activeKey: CHAT }
      },
      focusedPaneId: 'top',
      maximizedPaneId: null
    })
  })

  it('keeps focus where it is when another pane closes', () => {
    const next = closeSplitViewChips({ ...threePanes, focusedPaneId: 'bottom' }, new Set([ALPHA]))

    expect(next.focusedPaneId).toBe('bottom')
  })

  it('maximizes the pane that takes focus when the maximized pane closes', () => {
    const next = closeSplitViewChips(
      { ...threePanes, focusedPaneId: 'bottom', maximizedPaneId: 'bottom' },
      new Set([CHAT, DOCS])
    )

    expect(next.maximizedPaneId).toBe('top')
  })

  it('returns the same state when there is nothing to close', () => {
    expect(closeSplitViewChips(sideBySide, new Set())).toBe(sideBySide)
  })
})

describe('splitViewPaneKeys', () => {
  it("lists a pane's chips in strip order", () => {
    expect(splitViewPaneKeys(threeChips, 'left')).toEqual([ALPHA, BETA, DOCS])
  })
})

describe('splitViewKeysOtherThan', () => {
  it('names every chip of the pane except the one kept', () => {
    expect(splitViewKeysOtherThan(threeChips, 'left', BETA)).toEqual(new Set([ALPHA, DOCS]))
  })
})

describe('splitViewFocusAfterClose', () => {
  it('picks the chip after the closed one in the focused pane', () => {
    expect(splitViewFocusAfterClose(threeChips, new Set([BETA]))).toEqual({
      kind: 'project',
      repoId: 'repo-docs',
      hostId: 'host-1'
    })
  })

  it('picks the chip before when the closed one was last in the strip', () => {
    const showingLast: SplitViewState = {
      ...threeChips,
      panes: { ...threeChips.panes, left: { tabs: [alphaTab, betaTab, docsTab], activeKey: DOCS } }
    }

    expect(splitViewFocusAfterClose(showingLast, new Set([DOCS]))).toEqual({
      kind: 'workspace',
      worktreeId: 'wt-beta',
      hostId: 'host-1'
    })
  })

  it("keeps the focused pane's chip when the closed chips are elsewhere", () => {
    expect(splitViewFocusAfterClose(sideBySide, new Set([CHAT]))).toEqual({
      kind: 'workspace',
      worktreeId: 'wt-alpha',
      hostId: null
    })
  })

  it("picks the sibling pane's shown chip when the focused pane empties", () => {
    expect(
      splitViewFocusAfterClose({ ...threePanes, focusedPaneId: 'bottom' }, new Set([CHAT, DOCS]))
    ).toEqual({ kind: 'workspace', worktreeId: 'wt-beta', hostId: 'host-1' })
  })

  it("prefers a chip that can be resolved over the sibling's", () => {
    expect(
      splitViewFocusAfterClose(
        { ...threePanes, focusedPaneId: 'bottom' },
        new Set([CHAT, DOCS]),
        (item) => item.kind === 'workspace' && item.worktreeId === 'wt-alpha'
      )
    ).toEqual({ kind: 'workspace', worktreeId: 'wt-alpha', hostId: null })
  })

  it("still picks the sibling's chip when nothing can be resolved", () => {
    expect(
      splitViewFocusAfterClose(
        { ...threePanes, focusedPaneId: 'bottom' },
        new Set([CHAT, DOCS]),
        () => false
      )
    ).toEqual({ kind: 'workspace', worktreeId: 'wt-beta', hostId: 'host-1' })
  })

  it('has nowhere to go when every chip closes', () => {
    expect(splitViewFocusAfterClose(sideBySide, new Set([ALPHA, BETA, CHAT]))).toBeNull()
  })
})

describe('neighbourSplitViewPane', () => {
  it('steps through panes in tree order', () => {
    const fromTop = { ...threePanes, focusedPaneId: 'top' }

    expect(neighbourSplitViewPane(fromTop, 1)).toBe('bottom')
    expect(neighbourSplitViewPane(fromTop, -1)).toBe('left')
  })

  it('wraps around at both ends', () => {
    expect(neighbourSplitViewPane({ ...threePanes, focusedPaneId: 'bottom' }, 1)).toBe('left')
    expect(neighbourSplitViewPane({ ...threePanes, focusedPaneId: 'left' }, -1)).toBe('bottom')
  })

  it('has no neighbour in a grid of one pane', () => {
    const onePane: SplitViewState = {
      layout: { type: 'leaf', groupId: 'left' },
      panes: { left: { tabs: [alphaTab, betaTab], activeKey: ALPHA } },
      focusedPaneId: 'left',
      maximizedPaneId: null
    }

    expect(neighbourSplitViewPane(onePane, 1)).toBeNull()
  })
})
