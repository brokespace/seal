// Real Git behind the real `worktree.rm` method: a Git lock refuses deletion until the caller confirms the unlock.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../orca-runtime'
import {
  partialRuntimeStore,
  storeRepo,
  storeWorktreeMeta
} from '../../../orca-runtime-tests/runtime-store-partial-fixture'
import type { WorktreeMeta } from '../../../../../shared/worktree/meta-types'
import type { HostWorktreeTarget } from '../../../../../shared/worktree/host-qualified-identity'
import * as appEnvironment from '../../../../../shared/app-environment'
import { RpcDispatcher } from '../../dispatcher'
import { WORKTREE_METHODS } from './worktree'
import type { RpcResponse } from '../../core'
import { installRealWorkerThreadChildProcesses } from '../../../../worker-thread-child-process/worker-thread-child-process-real.test-fixtures'
import { removeTree } from '../../../../../shared/windows-transient-lock-removal'
import {
  _resetPendingWorktreeRemovalsForTests,
  _settlePendingWorktreeRemovalsForTests,
  loadWorktreeRemovalRecords
} from '../../../../workspaces/removal/worktree-background-removal'

installRealWorkerThreadChildProcesses()

const exec = promisify(execFile)
let directory = ''
let repoPath = ''
let checkout = ''
let id = ''
let dispatcher: RpcDispatcher
const git = async (...args: string[]) => (await exec('git', args, { cwd: repoPath })).stdout.trim()

function remove(params: Record<string, unknown> = {}): Promise<RpcResponse> {
  return dispatcher.dispatch({
    id: 'rm',
    authToken: 'test',
    method: 'worktree.rm',
    params: { worktree: `id:${id}`, force: true, ...params }
  })
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'seal-rm-locked-')))
  await loadWorktreeRemovalRecords(directory)
  repoPath = join(directory, 'alpharidge-app')
  checkout = join(directory, 'ribbonworm')
  id = `repo::${checkout}`
  vi.stubEnv('ORCA_USER_DATA_PATH', directory)
  await mkdir(repoPath)
  await git('init', '-q')
  await git('checkout', '-qb', 'main')
  await git('config', 'user.email', 'rm@example.invalid')
  await git('config', 'user.name', 'Locked Removal')
  await git('config', 'maintenance.auto', 'false')
  await git('config', 'gc.auto', '0')
  await writeFile(join(repoPath, 'file'), 'seed')
  await git('add', '.')
  await git('commit', '-qm', 'seed')
  await git('worktree', 'add', '-qb', 'ribbonworm', checkout)
  await git('worktree', 'lock', '--reason', 'agent running', checkout)
  vi.spyOn(appEnvironment, 'getAppEnvironment').mockReturnValue({
    getPath: () => directory,
    getAppPath: () => directory,
    getVersion: () => 'test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
  const repo = storeRepo({ id: 'repo', path: repoPath })
  const meta: Record<string, WorktreeMeta> = {
    [id]: storeWorktreeMeta({
      displayName: 'ribbonworm',
      instanceId: 'ribbonworm',
      hostId: 'local'
    })
  }
  const store = partialRuntimeStore({
    getRepos: () => [repo],
    getSshTargets: () => [],
    getRepo: (repoId) => (repoId === repo.id ? repo : undefined),
    getAllWorktreeMeta: () => meta,
    getWorktreeMeta: (key) => meta[key],
    setWorktreeMeta: ({ id: key }: HostWorktreeTarget, value: Partial<WorktreeMeta>) =>
      (meta[key] = { ...storeWorktreeMeta(), ...meta[key], ...value }),
    removeWorktreeMeta: ({ id: key }: HostWorktreeTarget) => {
      delete meta[key]
    },
    getAllWorktreeLineage: () => ({}),
    getAllWorkspaceLineage: () => ({}),
    getProjects: () => [],
    getProfileStorageDirectory: () => directory,
    getRetiredWorktreeNameRegistry: () => ({ exhaustedTiers: 0, names: [] }),
    addRetiredWorktreeName: () => {},
    mergeRetiredWorktreeNames: () => false,
    flushOrThrow: () => {}
  })
  const runtime = new OrcaRuntimeService(store)
  vi.spyOn(runtime, 'machineNameReady').mockResolvedValue(undefined)
  vi.spyOn(runtime, 'acquireFileWatcherRemoval').mockResolvedValue({ finish: async () => {} })
  vi.spyOn(runtime, 'closeFileWatchersForRemoval').mockResolvedValue(undefined)
  vi.spyOn(runtime, 'stopPtysForDestructiveWorktreeRemoval').mockResolvedValue(undefined)
  vi.spyOn(runtime, 'notifyWorktreesChanged').mockImplementation(() => {})
  dispatcher = new RpcDispatcher({ runtime, methods: [...WORKTREE_METHODS] })
})

afterEach(async () => {
  await _settlePendingWorktreeRemovalsForTests()
  _resetPendingWorktreeRemovalsForTests()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await removeTree(directory)
})

it('refuses a force delete of a Git-locked worktree and names the lock', async () => {
  const response = await remove()

  expect(response).toMatchObject({
    ok: false,
    error: {
      message: expect.stringContaining('Worktree is locked by Git. Lock reason: agent running.')
    }
  })
  expect(existsSync(checkout)).toBe(true)
  expect(await git('worktree', 'list', '--porcelain')).toContain('locked agent running')
})

it('unlocks and deletes a Git-locked worktree once the caller confirms the unlock', async () => {
  await writeFile(join(checkout, 'uncommitted'), 'dirty')

  const response = await remove({ unlockLockedWorktree: true })
  await _settlePendingWorktreeRemovalsForTests()

  expect(response.ok).toBe(true)
  expect(existsSync(checkout)).toBe(false)
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(checkout)
})

it('unlocks and clears a locked worktree whose folder is already gone', async () => {
  await rm(checkout, { recursive: true, force: true })

  const response = await remove({ unlockLockedWorktree: true })
  await _settlePendingWorktreeRemovalsForTests()

  expect(response.ok).toBe(true)
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(checkout)
})
