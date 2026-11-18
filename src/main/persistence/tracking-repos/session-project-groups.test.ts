import { expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { ProjectGroupPersistenceOperations } from './project-group-operations'

it('makes a project for sessions once, and not again after the user removes it unless asked by name', () => {
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

  operations.ensureSessionProjectGroups([fitness], true)
  expect(names()).toEqual(['fitness'])
})
