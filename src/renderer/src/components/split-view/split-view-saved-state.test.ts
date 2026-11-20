import { describe, expect, it } from 'vitest'
import { parseSavedSplitView, serializeSplitView } from './split-view-saved-state'
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

/** left [alpha] | top [beta] over bottom [delta, docs], as saved */
const savedThreePanes = {
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
    left: { items: [alpha], activeKey: ALPHA },
    top: { items: [beta], activeKey: BETA },
    bottom: { items: [delta, docs], activeKey: DOCS }
  },
  focusedPaneId: 'bottom'
}

const parse = (saved: unknown): SplitViewState => parseSavedSplitView(JSON.stringify(saved))

describe('serializeSplitView', () => {
  it("saves the tree, each pane's chips and shown chip, and the focused pane", () => {
    const state: SplitViewState = {
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
        bottom: { tabs: [deltaTab, { item: docs, preview: true }], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: 'bottom'
    }

    expect(JSON.parse(serializeSplitView(state) ?? '')).toEqual({
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
        left: {
          items: [{ kind: 'workspace', worktreeId: 'wt-alpha', hostId: null }],
          activeKey: 'workspace:wt-alpha'
        },
        top: {
          items: [{ kind: 'workspace', worktreeId: 'wt-beta', hostId: 'host-1' }],
          activeKey: 'workspace:wt-beta'
        },
        bottom: {
          items: [
            { kind: 'workspace', worktreeId: 'wt-delta', hostId: null },
            { kind: 'project', repoId: 'repo-docs', hostId: 'host-1' }
          ],
          activeKey: 'project:host-1\nrepo-docs'
        }
      },
      focusedPaneId: 'bottom'
    })
  })

  it('saves nothing when there is no split view', () => {
    expect(serializeSplitView(NO_SPLIT_VIEW)).toBeNull()
  })
})

describe('parseSavedSplitView', () => {
  it('restores what was serialized, with previews kept and nothing maximized', () => {
    const state: SplitViewState = {
      layout: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'top' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.3
      },
      panes: {
        top: { tabs: [alphaTab, { item: beta, preview: true }], activeKey: BETA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: 'bottom'
    }

    expect(parseSavedSplitView(serializeSplitView(state))).toEqual({
      layout: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'top' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.3
      },
      panes: {
        top: { tabs: [alphaTab, betaTab], activeKey: BETA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
  })

  it('restores a saved grid of three panes', () => {
    expect(parse(savedThreePanes)).toEqual({
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
        bottom: { tabs: [deltaTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
  })

  it('restores no split view from text that is not JSON', () => {
    expect(parseSavedSplitView('{not json')).toEqual(NO_SPLIT_VIEW)
  })

  it('restores no split view when nothing was saved', () => {
    expect(parseSavedSplitView(null)).toEqual(NO_SPLIT_VIEW)
  })

  it('drops an item of an unknown kind and keeps the rest of its pane', () => {
    const restored = parse({
      ...savedThreePanes,
      panes: {
        ...savedThreePanes.panes,
        bottom: { items: [delta, { kind: 'board', boardId: 'b1' }, docs], activeKey: DOCS }
      }
    })

    expect(restored.panes.bottom).toEqual({ tabs: [deltaTab, docsTab], activeKey: DOCS })
  })

  it('drops the session tabs an earlier version saved, and a pane left with none', () => {
    const restored = parse({
      ...savedThreePanes,
      panes: {
        left: { items: [alpha], activeKey: ALPHA },
        top: {
          items: [{ kind: 'session', sessionId: 'host-1:chat' }],
          activeKey: 'session:host-1:chat'
        },
        bottom: {
          items: [{ kind: 'session', sessionId: 'host-1:other' }, docs],
          activeKey: 'session:host-1:other'
        }
      },
      focusedPaneId: 'top'
    })

    expect(restored).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        bottom: { tabs: [docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
  })

  it('drops items that lack their identity and restores a workspace saved without a host', () => {
    const restored = parse({
      ...savedThreePanes,
      panes: {
        ...savedThreePanes.panes,
        bottom: {
          items: [
            { kind: 'workspace', hostId: 'host-1' },
            { kind: 'project', repoId: 'repo-docs' },
            { kind: 'workspace', worktreeId: '' },
            'workspace:wt-delta',
            { kind: 'workspace', worktreeId: 'wt-gamma' },
            docs
          ],
          activeKey: DOCS
        }
      }
    })

    expect(restored.panes.bottom).toEqual({
      tabs: [
        { item: { kind: 'workspace', worktreeId: 'wt-gamma', hostId: null }, preview: false },
        docsTab
      ],
      activeKey: DOCS
    })
  })

  it('keeps an item that was saved twice only in the first pane', () => {
    const restored = parse({
      ...savedThreePanes,
      panes: {
        left: { items: [alpha, alpha], activeKey: ALPHA },
        top: { items: [beta], activeKey: BETA },
        bottom: { items: [alpha, delta, docs], activeKey: ALPHA }
      }
    })

    expect(restored.panes).toEqual({
      left: { tabs: [alphaTab], activeKey: ALPHA },
      top: { tabs: [betaTab], activeKey: BETA },
      bottom: { tabs: [deltaTab, docsTab], activeKey: DELTA }
    })
  })

  it.each([
    { name: 'has no usable item', top: { items: [{ kind: 'board' }], activeKey: BETA } },
    { name: 'has items that are not a list', top: { items: 'workspace:wt-beta', activeKey: BETA } },
    { name: 'was not saved', top: undefined }
  ])('drops a pane that $name and gives its space to its sibling', ({ top }) => {
    expect(parse({ ...savedThreePanes, panes: { ...savedThreePanes.panes, top } })).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 0.6
      },
      panes: {
        left: { tabs: [alphaTab], activeKey: ALPHA },
        bottom: { tabs: [deltaTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
  })

  it('drops what is nested deeper than a layout may be', () => {
    const paneCount = 70
    const item = (index: number): SplitViewItem => ({
      kind: 'workspace',
      worktreeId: `wt-${index}`,
      hostId: null
    })
    let layout: unknown = { type: 'leaf', groupId: `p${paneCount - 1}` }
    for (let index = paneCount - 2; index >= 0; index--) {
      layout = {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: `p${index}` },
        second: layout
      }
    }
    const panes = Object.fromEntries(
      Array.from({ length: paneCount }, (_, index) => [
        `p${index}`,
        { items: [item(index)], activeKey: `workspace:wt-${index}` }
      ])
    )

    const restored = parse({ layout, panes, focusedPaneId: 'p0' })

    expect(Object.keys(restored.panes)).toHaveLength(64)
    expect(Object.keys(restored.panes).at(-1)).toBe('p63')
  })

  it('replaces a split that has a malformed child with its other child', () => {
    const restored = parse({
      ...savedThreePanes,
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf' },
          second: { type: 'leaf', groupId: 'bottom' },
          ratio: 0.3
        },
        ratio: 0.6
      }
    })

    expect(restored.layout).toEqual({
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: 'left' },
      second: { type: 'leaf', groupId: 'bottom' },
      ratio: 0.6
    })
  })

  it('keeps the readable half of a tree whose other half is not a node', () => {
    expect(
      parse({
        layout: {
          type: 'split',
          direction: 'horizontal',
          first: 'left',
          second: { type: 'leaf', groupId: 'bottom' },
          ratio: 0.6
        },
        panes: savedThreePanes.panes,
        focusedPaneId: 'bottom'
      })
    ).toEqual({
      layout: { type: 'leaf', groupId: 'bottom' },
      panes: { bottom: { tabs: [deltaTab, docsTab], activeKey: DOCS } },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
  })

  it('drops a pane id that the tree names a second time', () => {
    const restored = parse({
      ...savedThreePanes,
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'left' },
        second: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf', groupId: 'left' },
          second: { type: 'leaf', groupId: 'bottom' },
          ratio: 0.3
        },
        ratio: 0.6
      }
    })

    expect(restored.layout).toEqual({
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', groupId: 'left' },
      second: { type: 'leaf', groupId: 'bottom' },
      ratio: 0.6
    })
  })

  it('drops a ratio that is not a share of the split', () => {
    const restored = parse({
      layout: {
        type: 'split',
        direction: 'vertical',
        first: { type: 'leaf', groupId: 'top' },
        second: { type: 'leaf', groupId: 'bottom' },
        ratio: 4
      },
      panes: savedThreePanes.panes,
      focusedPaneId: 'bottom'
    })

    expect(restored.layout).toEqual({
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', groupId: 'top' },
      second: { type: 'leaf', groupId: 'bottom' }
    })
  })

  it("shows a pane's first chip when its saved shown chip is not in it", () => {
    const restored = parse({
      ...savedThreePanes,
      panes: {
        ...savedThreePanes.panes,
        bottom: { items: [delta, docs], activeKey: 'workspace:wt-closed' }
      }
    })

    expect(restored.panes.bottom).toEqual({ tabs: [deltaTab, docsTab], activeKey: DELTA })
  })

  it('focuses the first pane when the saved focus names no pane', () => {
    expect(parse({ ...savedThreePanes, focusedPaneId: 'closed' }).focusedPaneId).toBe('left')
  })

  it('restores no split view when a single chip is all that survives', () => {
    expect(
      parse({
        ...savedThreePanes,
        panes: { left: { items: [alpha], activeKey: ALPHA }, top: { items: [{ kind: 'board' }] } }
      })
    ).toEqual(NO_SPLIT_VIEW)
  })
})
