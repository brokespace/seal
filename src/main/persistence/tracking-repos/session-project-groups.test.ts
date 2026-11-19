import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { ProjectGroupPersistenceOperations } from './project-group-operations'

afterEach(() => {
  vi.useRealTimers()
})

it('makes a project for sessions once; one the user removes comes back for an agent started since, or by name', () => {
  vi.useFakeTimers({ now: 5_000 })
  const state = getDefaultPersistedState('/workspace')
  state.repos = [
    { id: 'r', path: '/code/alpharidge-app', displayName: 'App', badgeColor: '', addedAt: 0 }
  ]
  const operations = new ProjectGroupPersistenceOperations({
    state,
    scheduleSave: () => {},
    removeWorkspaceLineageForRemovedFolder: () => {},
    pruneMobileClientTabSelections: () => {}
  })
  const fitness = { key: 'folder:fitness', name: 'fitness' }
  const names = (): string[] => (state.projectGroups ?? []).map((group) => group.name)

  operations.ensureSessionProjectGroups(
    [fitness, { key: 'folder:alpharidge-app', name: 'Alpharidge-App' }],
    false
  )
  operations.ensureSessionProjectGroups([{ key: 'folder:Fitness', name: 'Fitness' }], false)
  expect(names()).toEqual(['fitness'])

  const [made] = state.projectGroups ?? []
  operations.updateProjectGroup(made.id, { name: 'Training' })
  operations.ensureSessionProjectGroups([fitness], false)
  expect(names()).toEqual(['Training'])

  operations.deleteProjectGroup(made.id)
  operations.ensureSessionProjectGroups([fitness], false)
  expect(names()).toEqual([])

  operations.ensureSessionProjectGroups([{ ...fitness, startedAt: 4_000 }], false)
  expect(names()).toEqual([])

  operations.ensureSessionProjectGroups([{ ...fitness, startedAt: 6_000 }], false)
  expect(names()).toEqual(['fitness'])

  const [again] = state.projectGroups ?? []
  operations.updateProjectGroup(again.id, { keptAt: 5_000 })
  operations.deleteProjectGroup(again.id)
  operations.ensureSessionProjectGroups([{ ...fitness, startedAt: 9_000 }], false)
  expect(names()).toEqual([])

  operations.ensureSessionProjectGroups([fitness], true)
  expect(names()).toEqual(['fitness'])
})
