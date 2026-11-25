import { describe, expect, it } from 'vitest'
import {
  placeSplitViewItems,
  seedSplitViewPane,
  setSplitViewRatio,
  settleSplitView,
  splitViewPaneIds,
  toggleSplitViewMaximize,
  withoutSplitViewKeys
} from './split-view-layout-transitions'
import type { SplitViewItem, SplitViewState, SplitViewTab } from './split-view-types'

const alpha: SplitViewItem = { kind: 'workspace', worktreeId: 'wt-alpha', hostId: null }
const beta: SplitViewItem = { kind: 'workspace', worktreeId: 'wt-beta', hostId: 'host-1' }
const delta: SplitViewItem = { kind: 'workspace', worktreeId: 'wt-delta', hostId: null }
const docs: SplitViewItem = { kind: 'project', repoId: 'repo-docs', hostId: 'host-1' }

const ALPHA = 'workspace:wt-alpha'
const BETA = 'workspace:wt-beta'
const DELTA = 'workspace:wt-delta'
const DOCS = 'project:host-1\nrepo-docs'

const alphaTab: SplitViewTab = { item: alpha, preview: false }
const betaTab: SplitViewTab = { item: beta, preview: false }
const deltaTab: SplitViewTab = { item: delta, preview: false }
const docsTab: SplitViewTab = { item: docs, preview: false }

const NO_SPLIT_VIEW = { layout: null, panes: {}, focusedPaneId: null, maximizedPaneId: null }

/** left [alpha, beta] | right [delta] */
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
    right: { tabs: [deltaTab], activeKey: DELTA }
  },
  focusedPaneId: 'left',
  maximizedPaneId: null
}

/** left [alpha] | top [beta] over bottom [delta, docs] */
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
    bottom: { tabs: [deltaTab, docsTab], activeKey: DELTA }
  },
  focusedPaneId: 'left',
  maximizedPaneId: null
}

describe('seedSplitViewPane', () => {
  it('turns what the main area showed into one focused pane of kept chips', () => {
    expect(seedSplitViewPane(NO_SPLIT_VIEW, 'seed', [delta, docs], DOCS)).toEqual({
      layout: { type: 'leaf', groupId: 'seed' },
      panes: { seed: { tabs: [deltaTab, docsTab], activeKey: DOCS } },
      focusedPaneId: 'seed',
      maximizedPaneId: null
    })
  })

  it('leaves an existing split view as it is', () => {
    expect(seedSplitViewPane(sideBySide, 'seed', [docs], DOCS)).toBe(sideBySide)
  })
})

describe('placeSplitViewItems: the first placement from a seeded pane', () => {
  const seeded = seedSplitViewPane(NO_SPLIT_VIEW, 'seed', [alpha], ALPHA)

  it.each([
    {
      zone: 'right' as const,
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'seed' },
        second: { type: 'leaf', groupId: 'new' },
        ratio: 0.5
      }
    },
    {
      zone: 'left' as const,
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'new' },
        second: { type: 'leaf', groupId: 'seed' },
        ratio: 0.5
      }
    },
    {
      zone: 'down' as const,
      layout: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'seed' },
        second: { type: 'leaf', groupId: 'new' },
        ratio: 0.5
      }
    },
    {
      zone: 'up' as const,
      layout: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'new' },
        second: { type: 'leaf', groupId: 'seed' },
        ratio: 0.5
      }
    }
  ])('splits $zone into a new focused pane', ({ zone, layout }) => {
    expect(
      placeSplitViewItems(seeded, [beta], { paneId: 'seed', zone }, { newPaneId: 'new' })
    ).toEqual({
      layout,
      panes: {
        seed: { tabs: [alphaTab], activeKey: ALPHA },
        new: { tabs: [betaTab], activeKey: BETA }
      },
      focusedPaneId: 'new',
      maximizedPaneId: null
    })
  })

  it('adds a center drop as a second chip of the seeded pane', () => {
    expect(
      placeSplitViewItems(seeded, [beta], { paneId: 'seed', zone: 'center' }, { newPaneId: 'new' })
    ).toEqual({
      layout: { type: 'leaf', groupId: 'seed' },
      panes: { seed: { tabs: [alphaTab, betaTab], activeKey: BETA } },
      focusedPaneId: 'seed',
      maximizedPaneId: null
    })
  })

  it('creates no split view when the only item showing is dropped beside itself', () => {
    expect(
      placeSplitViewItems(seeded, [alpha], { paneId: 'seed', zone: 'right' }, { newPaneId: 'new' })
    ).toEqual(NO_SPLIT_VIEW)
  })
})

describe('placeSplitViewItems: into a strip', () => {
  it('inserts at the strip index and focuses the pane', () => {
    const next = placeSplitViewItems(
      sideBySide,
      [docs],
      { paneId: 'left', zone: 'center', index: 1 },
      { newPaneId: 'new' }
    )

    expect(next.panes).toEqual({
      left: { tabs: [alphaTab, docsTab, betaTab], activeKey: DOCS },
      right: { tabs: [deltaTab], activeKey: DELTA }
    })
    expect(next.focusedPaneId).toBe('left')
  })

  it('appends when no index is given', () => {
    const next = placeSplitViewItems(
      sideBySide,
      [docs],
      { paneId: 'right', zone: 'center' },
      { newPaneId: 'new' }
    )

    expect(next.panes).toEqual({
      left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
      right: { tabs: [deltaTab, docsTab], activeKey: DOCS }
    })
    expect(next.focusedPaneId).toBe('right')
  })

  it('reorders a chip within its strip to the slot the index named before the move, selecting nothing', () => {
    const threeChips: SplitViewState = {
      ...sideBySide,
      focusedPaneId: 'right',
      panes: { ...sideBySide.panes, left: { tabs: [alphaTab, betaTab, docsTab], activeKey: BETA } }
    }
    const next = placeSplitViewItems(
      threeChips,
      [alpha],
      { paneId: 'left', zone: 'center', index: 2 },
      { newPaneId: 'new' }
    )

    expect(next.panes.left).toEqual({ tabs: [betaTab, alphaTab, docsTab], activeKey: BETA })
    expect(next.focusedPaneId).toBe('right')
  })

  it('moves an item that is already in another pane instead of duplicating it', () => {
    expect(
      placeSplitViewItems(
        sideBySide,
        [alpha],
        { paneId: 'right', zone: 'center' },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'right' },
        ratio: 0.5
      },
      panes: {
        left: { tabs: [betaTab], activeKey: BETA },
        right: { tabs: [deltaTab, alphaTab], activeKey: ALPHA }
      },
      focusedPaneId: 'right',
      maximizedPaneId: null
    })
  })

  it('treats a workspace listed by a second host as the same item', () => {
    const alphaOnSecondHost: SplitViewItem = {
      kind: 'workspace',
      worktreeId: 'wt-alpha',
      hostId: 'host-2'
    }
    const next = placeSplitViewItems(
      sideBySide,
      [alphaOnSecondHost],
      { paneId: 'right', zone: 'center' },
      { newPaneId: 'new' }
    )

    expect(next.panes).toEqual({
      left: { tabs: [betaTab], activeKey: BETA },
      right: { tabs: [deltaTab, { item: alphaOnSecondHost, preview: false }], activeKey: ALPHA }
    })
  })

  it('treats the same repo on two hosts as two projects', () => {
    const docsOnSecondHost: SplitViewItem = {
      kind: 'project',
      repoId: 'repo-docs',
      hostId: 'host-2'
    }
    const next = placeSplitViewItems(
      threePanes,
      [docsOnSecondHost],
      { paneId: 'bottom', zone: 'center' },
      { newPaneId: 'new' }
    )

    expect(next.panes.bottom).toEqual({
      tabs: [deltaTab, docsTab, { item: docsOnSecondHost, preview: false }],
      activeKey: 'project:host-2\nrepo-docs'
    })
  })

  it('keeps a preview chip once it is moved', () => {
    const withPreview: SplitViewState = {
      ...sideBySide,
      panes: {
        left: { tabs: [{ item: alpha, preview: true }, betaTab], activeKey: ALPHA },
        right: { tabs: [deltaTab], activeKey: DELTA }
      }
    }
    const next = placeSplitViewItems(
      withPreview,
      [alpha],
      { paneId: 'right', zone: 'center' },
      { newPaneId: 'new' }
    )

    expect(next.panes.right).toEqual({ tabs: [deltaTab, alphaTab], activeKey: ALPHA })
  })

  it('closes a pane whose last chip moves out and collapses the tree', () => {
    expect(
      placeSplitViewItems(
        threePanes,
        [beta],
        { paneId: 'left', zone: 'center' },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab, betaTab], activeKey: BETA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DELTA }
      },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('leaves one pane with several chips when the other pane is emptied', () => {
    expect(
      placeSplitViewItems(
        sideBySide,
        [delta],
        { paneId: 'left', zone: 'center' },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: { type: 'leaf', groupId: 'left' },
      panes: { left: { tabs: [alphaTab, betaTab, deltaTab], activeKey: DELTA } },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('places every item of a multi-selection and shows the first when none was grabbed', () => {
    expect(
      placeSplitViewItems(
        threePanes,
        [alpha, beta],
        { paneId: 'bottom', zone: 'center', index: 1 },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: { type: 'leaf', groupId: 'bottom' },
      panes: { bottom: { tabs: [deltaTab, alphaTab, betaTab, docsTab], activeKey: ALPHA } },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
  })
})

describe('placeSplitViewItems: beside a pane in an existing grid', () => {
  it('splits off the active chip and shows its neighbour in the pane it left', () => {
    expect(
      placeSplitViewItems(
        sideBySide,
        [alpha],
        { paneId: 'left', zone: 'down' },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf', groupId: 'left' },
          second: { type: 'leaf', groupId: 'new' },
          ratio: 0.5
        },
        second: { type: 'leaf', groupId: 'right' },
        ratio: 0.5
      },
      panes: {
        left: { tabs: [betaTab], activeKey: BETA },
        new: { tabs: [alphaTab], activeKey: ALPHA },
        right: { tabs: [deltaTab], activeKey: DELTA }
      },
      focusedPaneId: 'new',
      maximizedPaneId: null
    })
  })

  it('moves a pane when its only chip is dropped beside another pane', () => {
    expect(
      placeSplitViewItems(
        threePanes,
        [beta],
        { paneId: 'left', zone: 'left' },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', groupId: 'new' },
          second: { type: 'leaf', groupId: 'left' },
          ratio: 0.5
        },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        new: { tabs: [betaTab], activeKey: BETA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DELTA }
      },
      focusedPaneId: 'new',
      maximizedPaneId: null
    })
  })

  it('puts a multi-selection in one new pane showing the grabbed item', () => {
    expect(
      placeSplitViewItems(
        sideBySide,
        [docs, beta],
        { paneId: 'right', zone: 'up' },
        { newPaneId: 'new', activeKey: BETA }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf', groupId: 'new' },
          second: { type: 'leaf', groupId: 'right' },
          ratio: 0.5
        },
        ratio: 0.5
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        new: { tabs: [docsTab, betaTab], activeKey: BETA },
        right: { tabs: [deltaTab], activeKey: DELTA }
      },
      focusedPaneId: 'new',
      maximizedPaneId: null
    })
  })

  it('keeps a pane as it is when its only chip is dropped on its own edge', () => {
    expect(
      placeSplitViewItems(
        sideBySide,
        [delta],
        { paneId: 'right', zone: 'right' },
        { newPaneId: 'new' }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'right' },
        ratio: 0.5
      },
      panes: {
        left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
        right: { tabs: [deltaTab], activeKey: DELTA }
      },
      focusedPaneId: 'right',
      maximizedPaneId: null
    })
  })

  it('does nothing for a pane that is not in the grid', () => {
    expect(
      placeSplitViewItems(
        sideBySide,
        [docs],
        { paneId: 'gone', zone: 'right' },
        { newPaneId: 'new' }
      )
    ).toBe(sideBySide)
  })
})

describe('settleSplitView', () => {
  it('drops a pane with no chips and gives its space to its sibling', () => {
    expect(
      settleSplitView({
        ...threePanes,
        panes: { ...threePanes.panes, top: { tabs: [], activeKey: null } }
      })
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DELTA }
      },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('ends split view once a single pane with a single chip is left', () => {
    expect(
      settleSplitView({
        ...sideBySide,
        panes: {
          left: { tabs: [], activeKey: null },
          right: { tabs: [deltaTab], activeKey: DELTA }
        }
      })
    ).toEqual(NO_SPLIT_VIEW)
  })

  it('keeps a single pane that still has several chips', () => {
    expect(
      settleSplitView({
        ...sideBySide,
        panes: { ...sideBySide.panes, right: { tabs: [], activeKey: null } }
      })
    ).toEqual({
      layout: { type: 'leaf', groupId: 'left' },
      panes: { left: { tabs: [alphaTab, betaTab], activeKey: ALPHA } },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('keeps an item that sits in two panes only in the first, and shows a remaining chip', () => {
    const next = settleSplitView({
      ...sideBySide,
      panes: {
        left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
        right: { tabs: [alphaTab, deltaTab, docsTab], activeKey: ALPHA }
      }
    })

    expect(next.panes).toEqual({
      left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
      right: { tabs: [deltaTab, docsTab], activeKey: DELTA }
    })
  })

  it('drops panes that the layout does not name', () => {
    const next = settleSplitView({
      ...sideBySide,
      panes: { ...sideBySide.panes, stray: { tabs: [docsTab], activeKey: DOCS } }
    })

    expect(next.panes).toEqual({
      left: { tabs: [alphaTab, betaTab], activeKey: ALPHA },
      right: { tabs: [deltaTab], activeKey: DELTA }
    })
  })

  it('moves focus from an emptied pane to its sibling', () => {
    const next = settleSplitView({
      ...threePanes,
      panes: { ...threePanes.panes, bottom: { tabs: [], activeKey: null } },
      focusedPaneId: 'bottom'
    })

    expect(next.focusedPaneId).toBe('top')
  })

  it('focuses the first pane when focus names no pane', () => {
    expect(settleSplitView({ ...threePanes, focusedPaneId: 'gone' }).focusedPaneId).toBe('left')
  })

  it('moves maximize to the focused pane', () => {
    const next = settleSplitView({ ...sideBySide, focusedPaneId: 'right', maximizedPaneId: 'left' })

    expect(next.maximizedPaneId).toBe('right')
  })

  it('clears maximize once one pane is left', () => {
    const next = settleSplitView({
      ...sideBySide,
      panes: { ...sideBySide.panes, right: { tabs: [], activeKey: null } },
      maximizedPaneId: 'left'
    })

    expect(next.maximizedPaneId).toBeNull()
  })
})

describe('withoutSplitViewKeys', () => {
  const panes = {
    left: { tabs: [alphaTab, betaTab, docsTab], activeKey: BETA },
    right: { tabs: [deltaTab], activeKey: DELTA }
  }

  it('removes the keys and shows the chip after a removed active chip', () => {
    expect(withoutSplitViewKeys(panes, new Set([BETA]))).toEqual({
      left: { tabs: [alphaTab, docsTab], activeKey: DOCS },
      right: { tabs: [deltaTab], activeKey: DELTA }
    })
  })

  it('shows the chip before when nothing is left after the removed active chip', () => {
    expect(withoutSplitViewKeys(panes, new Set([BETA, DOCS])).left).toEqual({
      tabs: [alphaTab],
      activeKey: ALPHA
    })
  })

  it('keeps the active chip when another chip is removed', () => {
    expect(withoutSplitViewKeys(panes, new Set([ALPHA])).left).toEqual({
      tabs: [betaTab, docsTab],
      activeKey: BETA
    })
  })

  it('leaves an emptied pane with no active chip', () => {
    expect(withoutSplitViewKeys(panes, new Set([DELTA])).right).toEqual({
      tabs: [],
      activeKey: null
    })
  })
})

describe('setSplitViewRatio', () => {
  it('sets the root split ratio for the empty path and nothing else', () => {
    expect(setSplitViewRatio(threePanes, '', 0.25)).toEqual({
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
        ratio: 0.25
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        top: { tabs: [betaTab], activeKey: BETA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DELTA }
      },
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('sets the ratio of the nested split a dotted path names', () => {
    const nested: SplitViewState = {
      ...threePanes,
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: {
          type: 'split',
          direction: 'vertical',
          first: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', groupId: 'top' },
            second: { type: 'leaf', groupId: 'corner' },
            ratio: 0.5
          },
          second: { type: 'leaf', groupId: 'bottom' },
          ratio: 0.3
        },
        ratio: 0.6
      }
    }

    expect(setSplitViewRatio(nested, 'second.first', 0.8).layout).toEqual({
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: 'left' },
      second: {
        type: 'split',
        direction: 'vertical',
        first: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', groupId: 'top' },
          second: { type: 'leaf', groupId: 'corner' },
          ratio: 0.8
        },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.3
      },
      ratio: 0.6
    })
  })
})

describe('toggleSplitViewMaximize', () => {
  it('maximizes the focused pane and restores the grid on the next toggle', () => {
    const maximized = toggleSplitViewMaximize(sideBySide)

    expect(maximized).toEqual({ ...sideBySide, focusedPaneId: 'left', maximizedPaneId: 'left' })
    expect(toggleSplitViewMaximize(maximized)).toEqual({
      ...sideBySide,
      focusedPaneId: 'left',
      maximizedPaneId: null
    })
  })

  it('focuses the pane it is asked to maximize', () => {
    expect(toggleSplitViewMaximize(sideBySide, 'right')).toEqual({
      ...sideBySide,
      focusedPaneId: 'right',
      maximizedPaneId: 'right'
    })
  })

  it('does nothing for a pane that is not in the grid', () => {
    expect(toggleSplitViewMaximize(sideBySide, 'gone')).toBe(sideBySide)
  })
})

describe('splitViewPaneIds', () => {
  it('lists panes in tree order, first child before second', () => {
    expect(splitViewPaneIds(threePanes.layout)).toEqual(['left', 'top', 'bottom'])
  })
})
