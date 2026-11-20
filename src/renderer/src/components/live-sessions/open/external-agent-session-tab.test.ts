// @vitest-environment happy-dom

import { afterEach, expect, it } from 'vitest'
import { useAppStore } from '@/store/index'
import {
  activateExternalAgentSessionTab,
  findExternalAgentSessionTab,
  openExternalAgentSessionTab,
  renameExternalAgentSessionTabs
} from './external-agent-session-tab'

const WT = 'repo::/workspace'
const initialState = useAppStore.getInitialState()
afterEach(() => {
  useAppStore.setState(initialState, true)
})

function open(sessionId: string, mode: 'preview' | 'tab' | 'split'): string {
  const id = openExternalAgentSessionTab({
    worktreeId: WT,
    sessionId,
    mode,
    label: sessionId,
    agent: 'claude'
  })
  expect(id).not.toBeNull()
  return id!
}

function tabs() {
  return useAppStore.getState().unifiedTabsByWorktree[WT] ?? []
}

it('replaces only the external preview of the group and keeps a tab opened to stay', () => {
  const editor = useAppStore.getState().createUnifiedTab(WT, 'editor', {
    id: 'editor',
    entityId: 'file',
    isPreview: true
  })
  const first = open('s1', 'preview')
  const second = open('s2', 'preview')

  expect(tabs().map((tab) => tab.id)).toEqual([editor.id, second])
  expect(tabs().find((tab) => tab.id === first)).toBeUndefined()
  expect(tabs().map((tab) => tab.isPreview)).toEqual([true, true])

  // A click on the tab does not keep it; opening the session to stay does, in the same tab.
  expect(activateExternalAgentSessionTab(WT, second)).toBe(true)
  expect(tabs()[1].isPreview).toBe(true)
  expect(open('s2', 'tab')).toBe(second)
  expect(tabs()[1].isPreview).toBe(false)

  open('s3', 'preview')
  expect(tabs().map((tab) => tab.entityId)).toEqual(['file', 's2', 's3'])
})

it('opens beside the focused group, survives reconciliation and follows a renamed session', () => {
  open('s1', 'tab')
  const split = open('s2', 'split')
  const state = useAppStore.getState()

  expect(state.groupsByWorktree[WT]).toHaveLength(2)
  expect(state.activeGroupIdByWorktree[WT]).toBe(tabs()[1].groupId)
  expect(tabs()[0].groupId).not.toBe(tabs()[1].groupId)
  expect(state.activeTabTypeByWorktree[WT]).toBe('agent-session')

  expect(state.reconcileWorktreeTabModel(WT).renderableTabCount).toBe(2)
  expect(tabs().map((tab) => tab.contentType)).toEqual([
    'external-agent-session',
    'external-agent-session'
  ])

  renameExternalAgentSessionTabs('s2', 's2-renamed')
  expect(findExternalAgentSessionTab(useAppStore.getState(), 's2')).toBeNull()
  expect(findExternalAgentSessionTab(useAppStore.getState(), 's2-renamed')?.id).toBe(split)
})
