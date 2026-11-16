import { describe, expect, it } from 'vitest'
import { groupLiveSessionsByWorkspace } from './live-session-workspace-groups'
import type { LiveSessionStatus } from './live-session-types'

const LAPTOP = { hostId: 'local', label: 'laptop' }
const GPU = { hostId: 'ssh-gpu', label: 'gpu-box' }

function session(
  id: string,
  status: LiveSessionStatus,
  cwd: string | null,
  patch: {
    machine?: typeof LAPTOP
    workspace?: { worktreeId: string; projectKey: string }
    pinned?: boolean
  } = {}
) {
  return {
    id,
    status,
    lastActivityAt: 1,
    cwd,
    project: cwd?.split('/').at(-1) ?? null,
    machine: LAPTOP,
    ...patch
  }
}

function outline(
  groups: ReturnType<typeof groupLiveSessionsByWorkspace<ReturnType<typeof session>>>
) {
  return groups.map((project) => [
    project.label,
    project.workspaces.map((workspace) => [
      workspace.label,
      workspace.machine.label,
      workspace.sessions.map((entry) => entry.id)
    ])
  ])
}

describe('groupLiveSessionsByWorkspace', () => {
  it('lists linked sessions under their project and workspace, whatever machine the workspace is on', () => {
    const shop = (worktreeId: string) => ({ worktreeId, projectKey: 'github:acme/shop' })
    const sessions = [
      session('idle', 'idle', '/code/shop', { workspace: shop('shop::/code/shop') }),
      session('asks', 'waiting-input', '/code/shop', { workspace: shop('shop::/code/shop') }),
      session('train', 'working', '/srv/shop', {
        machine: GPU,
        workspace: shop('shop::/srv/shop')
      }),
      session('docs', 'working', '/code/docs', {
        workspace: { worktreeId: 'docs::/code/docs', projectKey: 'github:acme/docs' }
      })
    ]
    expect(outline(groupLiveSessionsByWorkspace(sessions))).toEqual([
      ['docs', [['/code/docs', 'laptop', ['docs']]]],
      [
        'shop',
        [
          ['/code/shop', 'laptop', ['asks', 'idle']],
          ['/srv/shop', 'gpu-box', ['train']]
        ]
      ]
    ])
  })

  it('lists a session no registry linked by its folder on its machine, and one without a folder last', () => {
    const sessions = [
      session('nowhere', 'working', null),
      session('gpu', 'working', '/srv/shop', { machine: GPU }),
      session('laptop', 'idle', '/srv/shop'),
      session('pinned', 'idle', '/srv/shop', { pinned: true })
    ]
    expect(outline(groupLiveSessionsByWorkspace(sessions))).toEqual([
      [
        'shop',
        [
          ['/srv/shop', 'gpu-box', ['gpu']],
          ['/srv/shop', 'laptop', ['pinned', 'laptop']]
        ]
      ],
      [null, [[null, 'laptop', ['nowhere']]]]
    ])
  })

  it('names groups as the client resolves them', () => {
    const sessions = [session('a', 'idle', '/code/shop'), session('b', 'idle', '/code/shop-2')]
    const groups = groupLiveSessionsByWorkspace(sessions, (entry) => ({
      projectKey: 'repo-1',
      project: 'Shop',
      workspaceKey: entry.cwd ?? '',
      workspace: entry.id === 'a' ? 'main' : 'feature/payments'
    }))
    expect(outline(groups)).toEqual([
      [
        'Shop',
        [
          ['feature/payments', 'laptop', ['b']],
          ['main', 'laptop', ['a']]
        ]
      ]
    ])
  })
})
