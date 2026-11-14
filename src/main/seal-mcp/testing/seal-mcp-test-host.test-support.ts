import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SealMcpClientCreateArgs } from '../../../shared/seal-mcp/seal-mcp-types'
import { createLocalMachine } from '../../home-chat/machines/home-chat-local-machine'
import type { HomeChatMachine } from '../../home-chat/machines/home-chat-machine-types'
import type { HomeChatSessionSummary } from '../../home-chat/seal/home-chat-session-access'
import {
  createTestHomeChatRuntime,
  unusedSeal
} from '../../home-chat/testing/home-chat-runtime.test-support'
import { SealMcpService } from '../seal-mcp-service'

export const GPU_MACHINE_ID = 'machine:gpu'

function session(id: string, machineId: string, machineLabel: string): HomeChatSessionSummary {
  return {
    id,
    agent: 'claude',
    machineId,
    machineLabel,
    origin: 'seal',
    project: 'seal',
    cwd: '/work/seal',
    title: `Session ${id}`,
    status: 'working',
    statusDetail: null,
    lastActivityAt: 1_700_000_000_000,
    alive: true,
    canTakeOver: false
  }
}

export type SealMcpTestHost = {
  service: SealMcpService
  /** A scratch folder on "both machines", which are this computer under two names. */
  root: string
  rpcCalls: { method: string; params: unknown }[]
  sentToSessions: { sessionId: string; text: string }[]
  /** Argument lists of every `seal` CLI run a tool asked for; each one succeeds. */
  cliRuns: string[][]
  createToken: (args?: Partial<SealMcpClientCreateArgs>) => { token: string; clientId: string }
  dispose: () => Promise<void>
}

/**
 * A real MCP service over the real Home assistant tools. Its two machines, `local` and
 * `machine:gpu`, both run on this computer; sessions and Seal's RPC methods are canned.
 */
export async function createSealMcpTestHost(
  options: { approvalTimeoutMs?: number } = {}
): Promise<SealMcpTestHost> {
  const root = await mkdtemp(join(tmpdir(), 'seal-mcp-'))
  // Background jobs live under ~/.seal/jobs on the target machine.
  const originalHome = process.env.HOME
  process.env.HOME = root
  const local = createLocalMachine()
  const gpu: HomeChatMachine = {
    ...local,
    info: {
      ...local.info,
      id: GPU_MACHINE_ID,
      label: 'gpu',
      kind: 'remote',
      executionHostId: 'ssh:gpu'
    }
  }
  const sessions = [
    session('s-local', 'local', local.info.label),
    session('s-gpu', gpu.info.id, 'gpu')
  ]
  const rpcCalls: SealMcpTestHost['rpcCalls'] = []
  const sentToSessions: SealMcpTestHost['sentToSessions'] = []
  const cliRuns: string[][] = []
  const { runtime } = createTestHomeChatRuntime(
    join(root, 'state'),
    {
      list: () => Promise.resolve([local.info, gpu.info]),
      open: (id) =>
        id === 'local' || id === GPU_MACHINE_ID
          ? Promise.resolve(id === 'local' ? local : gpu)
          : Promise.reject(new Error(`No machine named "${id}".`))
    },
    {
      seal: {
        ...unusedSeal,
        sessions: {
          list: () => Promise.resolve({ sessions, errors: [] }),
          transcript: (sessionId) => Promise.resolve(`transcript of ${sessionId}`),
          send: (sessionId, text) => {
            sentToSessions.push({ sessionId, text })
            return Promise.resolve({ state: 'delivered', route: 'seal-pane', error: null })
          }
        }
      }
    }
  )
  await runtime.load()
  const callRpc = (method: string, params?: unknown): Promise<unknown> => {
    rpcCalls.push({ method, params })
    switch (method) {
      case 'repo.list':
        return Promise.resolve({
          repos: [
            { id: 'r-local', displayName: 'seal', path: '/work/seal', kind: 'git' },
            { id: 'r-gpu', displayName: 'models', path: '/srv/models', executionHostId: 'ssh:gpu' }
          ]
        })
      case 'worktree.list':
        return Promise.resolve({
          worktrees: [
            {
              id: 'w-1',
              repoId: 'r-local',
              displayName: 'main',
              path: '/work/seal',
              git: { branch: 'main' }
            },
            {
              id: 'w-2',
              repoId: 'r-gpu',
              displayName: 'train',
              path: '/srv/models',
              git: { branch: 'train' }
            }
          ]
        })
      case 'liveSessions.remove':
        return Promise.resolve({ removed: ['s-local'], failed: [] })
      default:
        return Promise.reject(new Error(`unexpected RPC ${method}`))
    }
  }
  const service = new SealMcpService({
    dir: join(root, 'mcp'),
    version: '0.0.0-test',
    approvalTimeoutMs: options.approvalTimeoutMs,
    runtime: () =>
      Promise.resolve({
        services: runtime.services,
        machines: runtime.machines,
        runOrcaCli: (args) => {
          cliRuns.push([...args])
          return Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false })
        },
        callRpc
      })
  })
  await service.start()
  return {
    service,
    root,
    rpcCalls,
    sentToSessions,
    cliRuns,
    createToken: (args = {}) => {
      const created = service.createClient({ name: 'test client', scopes: ['read'], ...args })
      return { token: created.token, clientId: created.client.id }
    },
    dispose: async () => {
      await service.stop()
      runtime.dispose()
      process.env.HOME = originalHome
      await rm(root, { recursive: true, force: true })
    }
  }
}
