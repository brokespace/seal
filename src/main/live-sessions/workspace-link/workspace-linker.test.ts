import { expect, it, vi } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { Repo } from '../../../shared/repo-types'
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
      runtime: { addRepo, removeProject: vi.fn(), updateRepo: vi.fn() },
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
      runtime: { addRepo, removeProject: vi.fn(), updateRepo: vi.fn() },
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

it('links a session in a linked worktree to that worktree, listing it, not to the main checkout', async () => {
  const machine = { hostId: 'local', label: 'this computer', kind: 'local' } as const
  const session: LiveSession = {
    id: 'local:claude:wt',
    provider: 'claude',
    providerSessionId: 'wt',
    machine,
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/home/me/worktrees/feature/src',
    project: 'src',
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
  const repo: Repo = {
    id: 'r1',
    path: '/home/me/repo',
    displayName: 'repo',
    badgeColor: '',
    addedAt: 0,
    kind: 'git'
  }
  const main = {
    worktreeId: 'r1::/home/me/repo',
    projectKey: 'r1',
    hostId: LOCAL_EXECUTION_HOST_ID,
    path: '/home/me/repo'
  }
  const feature = {
    ...main,
    worktreeId: 'r1::/home/me/worktrees/feature',
    path: '/home/me/worktrees/feature'
  }
  let imported = false
  const updateRepo = vi.fn(async () => {
    imported = true
    return repo
  })
  const catalog = new WorkspaceLinkCatalog({
    read: async () => (imported ? [main, feature] : [main]),
    onChange: () => {}
  })
  await catalog.refresh()
  let linked = (_worktreeId: string): void => {}
  const linkedTo = new Promise<string>((resolve) => {
    linked = resolve
  })
  const linker: WorkspaceLinker = new WorkspaceLinker({
    runtime: { agentTransitions: { latestRow: () => null } },
    store: { getRepo: () => undefined, getFolderWorkspaces: () => [] },
    catalog,
    creation: new WorkspaceCreation({
      runtime: { addRepo: async () => repo, removeProject: vi.fn(), updateRepo },
      store: { getRepos: () => [repo], updateRepo: vi.fn() }
    }),
    probes: new FolderProbes(),
    host: () => ({
      machine,
      run: async () =>
        '@@HOME /home/me\n@@TMP \n@@ROOT /home/me/worktrees/feature\n@@MAIN /home/me/repo\n@@DONE\n'
    }),
    creates: () => true,
    localHome: '/home/me',
    onChange: () => {
      const worktreeId = linker.link(session).workspace?.worktreeId
      if (worktreeId) {
        linked(worktreeId)
      }
    }
  })

  linker.link(session)

  expect(await linkedTo).toBe('r1::/home/me/worktrees/feature')
  expect(updateRepo).toHaveBeenCalledWith(
    { selector: 'id:r1', hostId: LOCAL_EXECUTION_HOST_ID },
    {
      importedExternalWorktreePaths: ['/home/me/worktrees/feature'],
      externalWorktreeInboxBaselinePaths: ['/home/me/worktrees/feature']
    }
  )
})
