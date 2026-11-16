// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { createUIStore } from './ui-slice-test-harness'
import { readSavedProjectOverviewTarget } from './project-overview-target'

const shop = { id: 'shop', connectionId: null, executionHostId: undefined }
const api = { id: 'api', connectionId: null, executionHostId: 'runtime:gpu' } as const

beforeEach(() => {
  localStorage.clear()
})

describe('project overview navigation', () => {
  it('opens on the project and its machine, and goes back to where it was opened from', () => {
    const store = createUIStore()
    store.getState().setActiveView('home')

    store.getState().openProjectOverview(api)
    expect(store.getState().activeView).toBe('project')
    expect(store.getState().projectOverviewTarget).toEqual({ repoId: 'api', hostId: 'runtime:gpu' })

    store.getState().closeProjectOverview()
    expect(store.getState().activeView).toBe('home')
  })

  it('moving from one project to another still goes back to the view before the first', () => {
    const store = createUIStore()
    store.getState().setActiveView('tasks')

    store.getState().openProjectOverview(shop)
    store.getState().openProjectOverview(api)
    expect(store.getState().projectOverviewTarget).toEqual({ repoId: 'api', hostId: 'runtime:gpu' })

    store.getState().closeProjectOverview()
    expect(store.getState().activeView).toBe('tasks')
  })

  it('a new window starts with the project the last one showed', () => {
    createUIStore().getState().openProjectOverview(shop)
    expect(createUIStore().getState().projectOverviewTarget).toEqual({
      repoId: 'shop',
      hostId: 'local'
    })
  })

  it('ignores a saved project it cannot read', () => {
    localStorage.setItem('seal.projectOverviewTarget', '{"repoId":42}')
    expect(readSavedProjectOverviewTarget()).toBeNull()
    localStorage.setItem('seal.projectOverviewTarget', 'not json')
    expect(readSavedProjectOverviewTarget()).toBeNull()
  })
})
