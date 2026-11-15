import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createUIStore } from './ui-slice-test-harness'

const saveUi = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  saveUi.mockClear()
  vi.stubGlobal('window', { api: { ui: { set: saveUi } } })
})
afterEach(() => vi.unstubAllGlobals())

it('keeps Active agents folded when Projects is regrouped, and drops the project folds', () => {
  const store = createUIStore()
  for (const key of [
    'repo:seal',
    'active-agents',
    'active-agents:machine:gpu-box',
    'active-agents:finished-open'
  ]) {
    store.getState().toggleCollapsedGroup(key)
  }

  store.getState().setGroupBy('none')

  expect([...store.getState().collapsedGroups]).toEqual([
    'active-agents',
    'active-agents:machine:gpu-box',
    'active-agents:finished-open'
  ])
  expect(saveUi.mock.lastCall).toEqual([
    {
      groupBy: 'none',
      collapsedGroups: [
        'active-agents',
        'active-agents:machine:gpu-box',
        'active-agents:finished-open'
      ]
    }
  ])
})
