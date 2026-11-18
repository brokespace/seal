import { expect, it, vi } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { FolderProbes } from './folder-probe'
import { WorkspaceCreation } from './workspace-creation'
import { WorkspaceLinkCatalog } from './workspace-link-catalog'
import { WorkspaceLinker } from './workspace-linker'

it('names the repository of an ended session on an SSH host and makes no workspace for it', async () => {
  const machine = { hostId: 'box', label: 'box', kind: 'remote', connection: 'ssh' } as const
  const session: LiveSession = {
    id: 'box:claude:ended',
    provider: 'claude',
    providerSessionId: 'ended',
    machine,
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/srv/alpharidge-app/packages/web/src',
    project: 'src',
    title: null,
    status: 'done',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 0,
    startedAt: null,
    alive: false,
    pid: null,
    transcriptPath: null,
    inputRoutes: [],
    permission: null
  }
  const addRepo = vi.fn()
  const catalog = new WorkspaceLinkCatalog({ read: async () => [], onChange: () => {} })
  await catalog.refresh()
  let republish = (): void => {}
  const republished = new Promise<void>((resolve) => {
    republish = resolve
  })
  const linker = new WorkspaceLinker({
    runtime: { agentTransitions: { latestRow: () => null } },
    store: { getRepo: () => undefined, getFolderWorkspaces: () => [] },
    catalog,
    creation: new WorkspaceCreation({
      runtime: { addRepo, removeProject: vi.fn() },
      store: { getRepos: () => [], updateRepo: vi.fn() }
    }),
    probes: new FolderProbes(),
    host: () => ({
      machine,
      run: async () =>
        '@@HOME /home/b\n@@TMP \n@@ROOT /srv/alpharidge-app/packages/web\n@@MAIN /srv/alpharidge-app\n@@DONE\n'
    }),
    creates: () => true,
    localHome: '/home/me',
    onChange: republish
  })

  expect(linker.link(session)).toBe(session)
  await republished

  expect(linker.link(session).repository).toEqual({ name: 'alpharidge-app' })
  expect(addRepo).not.toHaveBeenCalled()
})

it('makes the project for the folder a session started in, not the subfolder it moved to', async () => {
  const machine = { hostId: 'local', label: 'this computer', kind: 'local' } as const
  const session: LiveSession = {
    id: 'local:claude:moved',
    provider: 'claude',
    providerSessionId: 'moved',
    machine,
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/home/me/notes/mobile/src/live-sessions',
    startCwd: '/home/me/notes',
    project: 'notes',
    title: null,
    status: 'working',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 0,
    startedAt: null,
    alive: true,
    pid: 1,
    transcriptPath: null,
    inputRoutes: [],
    permission: null
  }
  let added = (_path: string): void => {}
  const addedPath = new Promise<string>((resolve) => {
    added = resolve
  })
  const addRepo = vi.fn(async (path: string) => {
    added(path)
    return { id: 'r-notes', path, displayName: 'notes', badgeColor: '', addedAt: 0 }
  })
  const catalog = new WorkspaceLinkCatalog({ read: async () => [], onChange: () => {} })
  await catalog.refresh()
  const linker = new WorkspaceLinker({
    runtime: { agentTransitions: { latestRow: () => null } },
    store: { getRepo: () => undefined, getFolderWorkspaces: () => [] },
    catalog,
    creation: new WorkspaceCreation({
      runtime: { addRepo, removeProject: vi.fn() },
      store: { getRepos: () => [], updateRepo: vi.fn() }
    }),
    probes: new FolderProbes(),
    host: () => ({ machine, run: async () => '@@HOME /home/me\n@@TMP \n@@DONE\n' }),
    creates: () => true,
    localHome: '/home/me',
    onChange: () => {}
  })

  linker.link(session)

  expect(await addedPath).toBe('/home/me/notes')
})
