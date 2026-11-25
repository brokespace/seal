// @vitest-environment happy-dom

import { expect, it } from 'vitest'
import { sampleLiveSession } from '../live-session.test-fixture'
import { liveSessionPlaceResolver } from './live-session-workspace-place'

it("places a session by the registry's workspace, else this window's link, under the catalogue's names", () => {
  const placeOf = liveSessionPlaceResolver(
    new Map([
      ['linked', { worktreeId: 'shop::/code/shop' }],
      ['placed', { worktreeId: 'other::/code/other' }]
    ]),
    new Map([['shop::/code/shop', { projectKey: 'shop', project: 'Shop', workspace: 'main' }]])
  )
  const inShop = {
    projectKey: 'shop',
    project: 'Shop',
    workspaceKey: 'local\nshop::/code/shop',
    workspace: 'main'
  }
  expect(
    placeOf(
      sampleLiveSession('placed', {
        workspace: { worktreeId: 'shop::/code/shop', projectKey: 'github:acme/shop' }
      })
    )
  ).toEqual(inShop)
  expect(placeOf(sampleLiveSession('linked'))).toEqual(inShop)
  // A workspace this window does not have keeps the registry's project and the folder's names.
  expect(
    placeOf(
      sampleLiveSession('elsewhere', {
        cwd: '/srv/docs',
        project: 'docs',
        workspace: { worktreeId: 'docs::/srv/docs', projectKey: 'github:acme/docs' }
      })
    )
  ).toEqual({
    projectKey: 'github:acme/docs',
    project: 'docs',
    workspaceKey: 'local\ndocs::/srv/docs',
    workspace: '/srv/docs'
  })
  expect(placeOf(sampleLiveSession('loose'))).toEqual({
    projectKey: 'folder:seal',
    project: 'seal',
    workspaceKey: 'local\n/code/seal',
    workspace: '/code/seal'
  })
})
