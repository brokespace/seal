import { expect, it } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession } from '../live-session.test-fixture'
import type { LiveSessionLink } from './live-session-links'
import { buildSessionProjectCatalog } from './session-project-catalog'
import { groupSidebarSessions } from './sidebar-session-groups'

const REPO: Repo = {
  id: 'repo-1',
  path: '/code/alpharidge-app',
  displayName: 'alpharidge-app',
  badgeColor: '#000',
  addedAt: 0
}
const HEADER = 'repo:repo-1'
const CATALOG = buildSessionProjectCatalog({
  repos: [REPO],
  projectGroups: [],
  projection: { projects: [], setups: [] }
})
const LINK: LiveSessionLink = {
  worktreeId: 'repo-1::/code/alpharidge-app',
  repoId: 'repo-1',
  name: 'main'
}

function group(
  sessions: LiveSession[],
  links: [string, LiveSessionLink][] = [],
  listed: string[] = [HEADER]
): Record<string, unknown> {
  const groups = groupSidebarSessions(sessions, new Map(links), CATALOG, new Set(listed))
  const ids = (list: readonly LiveSession[]): string[] => list.map((session) => session.id)
  return {
    cards: [...groups.byWorkspace].map(([id, list]) => [id, ids(list)]),
    headers: [...groups.byHeader].map(([key, list]) => [key, ids(list)]),
    loose: groups.loose.map(({ name, sessions: list }) => [name, ids(list)]),
    unassigned: ids(groups.unassigned)
  }
}

it('gives every session with a folder a project, and leaves only one without a folder unassigned', () => {
  expect(
    group(
      [
        sampleLiveSession('on-card'),
        // No workspace: a folder named as a sidebar project is that project, on any machine.
        sampleLiveSession('same-name', {
          cwd: '/srv/Alpharidge-App',
          project: 'Alpharidge-App',
          machine: { hostId: 'kessel-ml', label: 'kessel-ml', kind: 'remote' }
        }),
        sampleLiveSession('in-repo', {
          cwd: '/srv/alpharidge-app/packages/api',
          project: 'api',
          repository: { name: 'alpharidge-app' }
        }),
        sampleLiveSession('fitness', { cwd: '/home/brian/fitness', project: 'fitness' }),
        sampleLiveSession('no-folder', { cwd: null, project: null })
      ],
      [['on-card', LINK]]
    )
  ).toEqual({
    cards: [['repo-1::/code/alpharidge-app', ['on-card']]],
    headers: [[HEADER, ['same-name', 'in-repo']]],
    loose: [['fitness', ['fitness']]],
    unassigned: ['no-folder']
  })
})

it('lists a session under the project the user moved it to, whatever its folder or workspace', () => {
  expect(
    group(
      [
        sampleLiveSession('off-card', {
          assignedProject: { key: 'folder:fitness', name: 'fitness' }
        }),
        sampleLiveSession('to-listed', {
          cwd: '/home/brian/fitness',
          project: 'fitness',
          assignedProject: { key: 'gone', name: 'ALPHARIDGE-APP' }
        }),
        sampleLiveSession('named', {
          cwd: null,
          project: null,
          assignedProject: { key: 'folder:Ops', name: 'Ops' }
        })
      ],
      [['off-card', LINK]]
    )
  ).toEqual({
    cards: [],
    headers: [[HEADER, ['to-listed']]],
    loose: [
      ['fitness', ['off-card']],
      ['Ops', ['named']]
    ],
    unassigned: []
  })
})

it('lists a project after the list while the list draws no header for it', () => {
  expect(
    group(
      [sampleLiveSession('same-name', { cwd: '/srv/alpharidge-app', project: 'alpharidge-app' })],
      [],
      []
    )
  ).toEqual({ cards: [], headers: [], loose: [['alpharidge-app', ['same-name']]], unassigned: [] })
})
