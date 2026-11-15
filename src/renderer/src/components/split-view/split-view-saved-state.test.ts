import { describe, expect, it } from 'vitest'
import {
  parseSavedSplitView,
  serializeSplitView,
  splitViewFromSessionTwoUp
} from './split-view-saved-state'
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

/** left [alpha] | top [beta] over bottom [chat, docs], as saved */
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
    bottom: { items: [chat, docs], activeKey: DOCS }
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
        bottom: { tabs: [chatTab, { item: docs, preview: true }], activeKey: DOCS }
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
            { kind: 'session', sessionId: 'host-1:chat' },
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
        bottom: { tabs: [chatTab, docsTab], activeKey: DOCS }
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
        bottom: { tabs: [chatTab, docsTab], activeKey: DOCS }
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
        bottom: { tabs: [chatTab, docsTab], activeKey: DOCS }
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
        bottom: { items: [chat, { kind: 'board', boardId: 'b1' }, docs], activeKey: DOCS }
      }
    })

    expect(restored.panes.bottom).toEqual({ tabs: [chatTab, docsTab], activeKey: DOCS })
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
            { kind: 'session', sessionId: '' },
            'session:host-1:chat',
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
        bottom: { items: [alpha, chat, docs], activeKey: ALPHA }
      }
    })

    expect(restored.panes).toEqual({
      left: { tabs: [alphaTab], activeKey: ALPHA },
      top: { tabs: [betaTab], activeKey: BETA },
      bottom: { tabs: [chatTab, docsTab], activeKey: CHAT }
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
        bottom: { tabs: [chatTab, docsTab], activeKey: DOCS }
      },
      focusedPaneId: 'bottom',
      maximizedPaneId: null
    })
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
      panes: { bottom: { tabs: [chatTab, docsTab], activeKey: DOCS } },
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
        bottom: { items: [chat, docs], activeKey: 'workspace:wt-closed' }
      }
    })

    expect(restored.panes.bottom).toEqual({ tabs: [chatTab, docsTab], activeKey: CHAT })
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

describe('splitViewFromSessionTwoUp', () => {
  it('turns a saved two-up into two panes, the split session alone on the right', () => {
    expect(
      splitViewFromSessionTwoUp(
        ['host-1:one', 'host-1:two', 'host-1:three'],
        'host-1:three',
        'host-1:two',
        {
          first: 'p1',
          second: 'p2'
        }
      )
    ).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'p1' },
        second: { type: 'leaf', groupId: 'p2' },
        ratio: 0.5
      },
      panes: {
        p1: {
          tabs: [
            { item: { kind: 'session', sessionId: 'host-1:one' }, preview: false },
            { item: { kind: 'session', sessionId: 'host-1:three' }, preview: false }
          ],
          activeKey: 'session:host-1:three'
        },
        p2: {
          tabs: [{ item: { kind: 'session', sessionId: 'host-1:two' }, preview: false }],
          activeKey: 'session:host-1:two'
        }
      },
      focusedPaneId: 'p1',
      maximizedPaneId: null
    })
  })

  it.each([
    { name: 'no session was split', activeId: 'host-1:one', splitId: null },
    {
      name: 'the split session is not an open tab',
      activeId: 'host-1:one',
      splitId: 'host-1:gone'
    },
    { name: 'the split session is the active one', activeId: 'host-1:two', splitId: 'host-1:two' }
  ])('creates no split view when $name', ({ activeId, splitId }) => {
    expect(
      splitViewFromSessionTwoUp(['host-1:one', 'host-1:two'], activeId, splitId, {
        first: 'p1',
        second: 'p2'
      })
    ).toEqual(NO_SPLIT_VIEW)
  })
})
