import { describe, expect, it } from 'vitest'
import {
  planWorkspace,
  workspaceForSession,
  type FolderProbe,
  type LinkableWorkspace,
  type SessionPlace
} from './workspace-link-rules'

const HOME = '/home/dev'

function workspace(worktreeId: string, path: string, hostId = 'local'): LinkableWorkspace {
  return { worktreeId, projectKey: `repo:${worktreeId}`, hostId, path }
}

const WORKSPACES = [
  workspace('shop', '/srv/shop'),
  workspace('shop-payments', '/srv/shop/worktrees/payments'),
  workspace('shop-on-box', '/srv/shop', 'ssh:box'),
  workspace('win', 'C:\\Code\\App', 'ssh:win'),
  workspace('home', HOME),
  workspace('notes', '/home/dev/notes')
]

function linked(place: Partial<SessionPlace>): string | null {
  return (
    workspaceForSession(
      { hostId: 'local', cwd: null, tabWorktreeId: null, ...place },
      WORKSPACES,
      HOME
    )?.worktreeId ?? null
  )
}

describe('workspaceForSession', () => {
  it.each<[string, Partial<SessionPlace>, string | null]>([
    ['its tab, whatever its folder', { tabWorktreeId: 'notes', cwd: '/srv/shop' }, 'notes'],
    ['its folder', { cwd: '/srv/shop' }, 'shop'],
    ['a subfolder', { cwd: '/srv/shop/src/cart' }, 'shop'],
    ['the longest ancestor', { cwd: '/srv/shop/worktrees/payments/src' }, 'shop-payments'],
    ['a folder that only shares a prefix', { cwd: '/srv/shop-old' }, null],
    [
      'the same path on another machine',
      { cwd: '/srv/shop/src', hostId: 'ssh:box' },
      'shop-on-box'
    ],
    ['a machine with no workspace there', { cwd: '/srv/shop', hostId: 'ssh:other' }, null],
    ['Windows separators', { cwd: 'C:\\Code\\App\\src', hostId: 'ssh:win' }, 'win'],
    ['mixed separators and case', { cwd: 'c:/code/app/src/ui', hostId: 'ssh:win' }, 'win'],
    ['the home directory itself', { cwd: HOME }, 'home'],
    ['a folder under home that no workspace holds', { cwd: '/home/dev/scratch' }, null],
    ['a workspace under home', { cwd: '/home/dev/notes/2026' }, 'notes'],
    ['no folder and no tab', {}, null]
  ])('links a session by %s', (_name, place, worktreeId) => {
    expect(linked(place)).toBe(worktreeId)
  })
})

describe('planWorkspace', () => {
  const folder: FolderProbe = { kind: 'folder', home: HOME, tmp: '/run/user/1000/tmp' }

  it.each<[string, string, FolderProbe, ReturnType<typeof planWorkspace>]>([
    [
      'a repository: its checkout, not the subfolder',
      '/srv/blog/posts',
      { kind: 'repository', root: '/srv/blog', home: HOME, tmp: null },
      { kind: 'checkout', path: '/srv/blog' }
    ],
    [
      'a repository in a temp folder: still its checkout',
      '/tmp/clone/src',
      { kind: 'repository', root: '/tmp/clone', home: HOME, tmp: null },
      { kind: 'checkout', path: '/tmp/clone' }
    ],
    [
      'a linked worktree: its main checkout',
      '/srv/blog-drafts/posts',
      {
        kind: 'repository',
        root: '/srv/blog-drafts',
        main: '/srv/blog',
        home: HOME,
        tmp: null
      },
      { kind: 'checkout', path: '/srv/blog' }
    ],
    [
      'a plain folder: that folder',
      '/srv/data/run',
      folder,
      { kind: 'folder', path: '/srv/data/run' }
    ],
    ['the home directory: the home workspace', HOME, folder, { kind: 'home', path: HOME }],
    ['a temp folder: the home workspace', '/tmp/scratch-1', folder, { kind: 'home', path: HOME }],
    ["the machine's own temp folder", '/run/user/1000/tmp/x', folder, { kind: 'home', path: HOME }],
    ['the filesystem root', '/', folder, { kind: 'home', path: HOME }],
    [
      'a shared folder on a machine whose home is unknown',
      '/tmp/x',
      { kind: 'folder', home: null, tmp: null },
      { kind: 'unassigned' }
    ],
    [
      'a folder its machine cannot read',
      '/srv/gone',
      { kind: 'unreadable' },
      { kind: 'unassigned' }
    ]
  ])('plans for %s', (_name, cwd, probe, plan) => {
    expect(planWorkspace(cwd, probe)).toEqual(plan)
  })
})
