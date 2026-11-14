import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SealMcpTransport } from '../../shared/seal-mcp/seal-mcp-types'
import {
  createSealMcpTestHost,
  GPU_MACHINE_ID,
  type SealMcpTestHost
} from './testing/seal-mcp-test-host.test-support'

let host: SealMcpTestHost
let nextId = 0

beforeEach(async () => {
  host = await createSealMcpTestHost({ approvalTimeoutMs: 150 })
})

afterEach(async () => {
  await host.dispose()
})

type ToolReply = { text: string; isError: boolean }

async function request(
  token: string,
  method: string,
  params: unknown,
  transport: SealMcpTransport = 'stdio'
): Promise<Record<string, unknown>> {
  const peer = { transport, remote: '203.0.113.7' }
  const admission = host.service.admit(token, peer)
  if (!admission.ok) {
    throw new Error(`not admitted: ${admission.reason}`)
  }
  const reply = await host.service.handle(admission.client, peer, {
    jsonrpc: '2.0',
    id: ++nextId,
    method,
    params
  })
  return reply ?? {}
}

async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown>,
  transport: SealMcpTransport = 'stdio'
): Promise<ToolReply> {
  const reply = await request(token, 'tools/call', { name, arguments: args }, transport)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shape tools/call always answers with.
  const result = reply.result as { content: { text: string }[]; isError: boolean }
  return { text: result.content[0].text, isError: result.isError }
}

async function listedTools(token: string): Promise<string[]> {
  const reply = await request(token, 'tools/list', {})
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shape tools/list always answers with.
  return (reply.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)
}

const lastAudit = (): Record<string, unknown> => ({ ...host.service.listAudit({ limit: 1 })[0] })

describe('SealMcpService sign-in', () => {
  it('admits a minted token and refuses a wrong, missing or revoked one', () => {
    const { token, clientId } = host.createToken()
    const peer = { transport: 'stdio' as const, remote: null }

    expect(host.service.admit(token, peer)).toMatchObject({ ok: true, client: { id: clientId } })
    expect(host.service.admit(`${token.slice(0, -1)}x`, peer)).toMatchObject({
      ok: false,
      reason: 'unauthorized'
    })
    expect(host.service.admit(null, peer)).toMatchObject({ ok: false, reason: 'unauthorized' })

    host.service.revokeClient(clientId)
    expect(host.service.admit(token, peer)).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(lastAudit()).toMatchObject({ outcome: 'unauthorized', clientId: null })
  })

  it('keeps the HTTP and relay doors shut until each is switched on', () => {
    const { token } = host.createToken({ allowRelay: true })
    const http = { transport: 'http' as const, remote: '10.0.0.5' }
    const relay = { transport: 'relay' as const, remote: '198.51.100.1' }

    expect(host.service.admit(token, http)).toMatchObject({ ok: false, reason: 'disabled' })
    expect(host.service.admit(token, relay)).toMatchObject({ ok: false, reason: 'disabled' })

    host.service.updateSettings({ httpEnabled: true })
    expect(host.service.admit(token, http).ok).toBe(true)
    expect(host.service.admit(token, relay)).toMatchObject({ ok: false, reason: 'disabled' })

    host.service.updateSettings({ relayEnabled: true })
    expect(host.service.admit(token, relay).ok).toBe(true)
  })

  it('lets only clients marked for the relay through it', () => {
    host.service.updateSettings({ relayEnabled: true })
    const { token } = host.createToken({ allowRelay: false })

    expect(host.service.admit(token, { transport: 'relay', remote: null })).toMatchObject({
      ok: false,
      reason: 'unauthorized'
    })
  })

  it('stops answering a peer that keeps presenting bad tokens', () => {
    const peer = { transport: 'stdio' as const, remote: '203.0.113.9' }
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(host.service.admit('smcp_bad', peer)).toMatchObject({ reason: 'unauthorized' })
    }
    const { token } = host.createToken()

    expect(host.service.admit(token, peer)).toMatchObject({ ok: false, reason: 'throttled' })
    expect(host.service.admit(token, { ...peer, remote: '203.0.113.10' }).ok).toBe(true)
  })

  it('never writes the token to disk', async () => {
    const { token } = host.createToken()
    await request(token, 'tools/list', {})
    await host.service.stop()

    const stored = `${await readFile(join(host.root, 'mcp', 'clients.json'), 'utf8')}${await readFile(join(host.root, 'mcp', 'audit.jsonl'), 'utf8')}`
    expect(stored).not.toContain(token)
    // The secret is base64url and may hold underscores itself, so it is cut out by position.
    expect(stored).not.toContain(token.slice('smcp_000000000000_'.length))
  })
})

describe('SealMcpService scopes', () => {
  it('lists only the tools a client was granted', async () => {
    const readOnly = host.createToken({ scopes: ['read'] })
    const operator = host.createToken({ scopes: ['read', 'sessions', 'files'] })

    expect(await listedTools(readOnly.token)).toEqual([
      'list_machines',
      'list_sessions',
      'read_session',
      'account_usage',
      'list_skills',
      'load_skill',
      'list_projects',
      'list_workspaces'
    ])
    expect(await listedTools(operator.token)).toEqual([
      'list_machines',
      'list_sessions',
      'read_session',
      'account_usage',
      'list_skills',
      'load_skill',
      'message_session',
      'start_session',
      'read_file',
      'write_file',
      'transfer_file',
      'list_projects',
      'list_workspaces'
    ])
  })

  it('refuses a tool outside the scopes and records the refusal', async () => {
    const { token, clientId } = host.createToken({ scopes: ['read'] })
    const target = join(host.root, 'note.txt')

    const reply = await callTool(token, 'write_file', {
      machine: 'local',
      path: target,
      content: 'x'
    })

    expect(reply.isError).toBe(true)
    await expect(readFile(target, 'utf8')).rejects.toThrow()
    expect(lastAudit()).toMatchObject({
      clientId,
      method: 'tools/call',
      tool: 'write_file',
      outcome: 'scope-denied'
    })
  })

  it('refuses a tool Seal does not expose over MCP at all', async () => {
    const { token } = host.createToken({
      scopes: ['read', 'sessions', 'files', 'commands', 'destructive']
    })

    const reply = await callTool(token, 'seal_cli', { args: ['status'] })

    expect(reply).toEqual({
      text: 'This MCP client has no tool "seal_cli". tools/list shows what it may call.',
      isError: true
    })
  })

  it('reads and writes files with the files scope, and logs the size, not the content', async () => {
    const { token } = host.createToken({ scopes: ['files'] })
    const target = join(host.root, 'note.txt')

    const written = await callTool(token, 'write_file', {
      machine: 'local',
      path: target,
      content: 'launch code 0000'
    })
    expect(written.isError).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('launch code 0000')
    expect(lastAudit()).toMatchObject({ tool: 'write_file', outcome: 'ok' })
    expect(String(lastAudit().summary)).toContain('content=<16 chars>')
    expect(String(lastAudit().summary)).not.toContain('launch code')

    const read = await callTool(token, 'read_file', { machine: 'local', path: target })
    expect(read.text).toContain('launch code 0000')
  })

  it('messages a session with the sessions scope', async () => {
    const { token } = host.createToken({ scopes: ['sessions'] })

    const reply = await callTool(token, 'message_session', { session_id: 's-gpu', text: 'status?' })

    expect(reply.isError).toBe(false)
    expect(host.sentToSessions).toEqual([{ sessionId: 's-gpu', text: 'status?' }])
  })
})

describe('SealMcpService machine allowlist', () => {
  it('hides and refuses machines outside the allowlist', async () => {
    const { token } = host.createToken({
      scopes: ['read', 'sessions', 'files'],
      machines: [GPU_MACHINE_ID]
    })
    const target = join(host.root, 'secret.txt')
    await writeFile(target, 'local only')

    const machines = await callTool(token, 'list_machines', {})
    expect(machines.text).toContain('gpu')
    expect(machines.text).not.toContain('this computer')

    const read = await callTool(token, 'read_file', { machine: 'local', path: target })
    expect(read.isError).toBe(true)
    expect(read.text).not.toContain('local only')
    expect(lastAudit()).toMatchObject({ tool: 'read_file', outcome: 'machine-denied' })

    const allowed = await callTool(token, 'read_file', { machine: 'gpu', path: target })
    expect(allowed.text).toContain('local only')
  })

  it('shows only sessions, projects and workspaces on allowed machines', async () => {
    const { token } = host.createToken({
      scopes: ['read', 'sessions'],
      machines: [GPU_MACHINE_ID]
    })

    const sessions = await callTool(token, 'list_sessions', {})
    expect(sessions.text).toContain('s-gpu')
    expect(sessions.text).not.toContain('s-local')

    const transcript = await callTool(token, 'read_session', { session_id: 's-local' })
    expect(transcript.isError).toBe(true)
    const message = await callTool(token, 'message_session', { session_id: 's-local', text: 'hi' })
    expect(message.isError).toBe(true)
    expect(host.sentToSessions).toEqual([])
  })
})

describe.skipIf(process.platform === 'win32')('SealMcpService commands and approval', () => {
  it('runs a command with the commands scope', async () => {
    const { token } = host.createToken({ scopes: ['commands'] })

    const reply = await callTool(token, 'run_command', { machine: 'local', command: 'echo seal' })

    expect(reply.text).toMatch(/^exit code 0/)
    expect(reply.text).toContain('seal')
    expect(lastAudit()).toMatchObject({ tool: 'run_command', outcome: 'ok', approved: null })
  })

  it('refuses a destructive command without the destructive scope', async () => {
    const { token } = host.createToken({ scopes: ['commands'] })
    const target = join(host.root, 'keep.txt')
    await writeFile(target, 'keep')

    const reply = await callTool(token, 'run_command', {
      machine: 'local',
      command: `rm -rf ${target}`
    })

    expect(reply.isError).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('keep')
    expect(lastAudit()).toMatchObject({ outcome: 'scope-denied' })
  })

  it('holds a destructive call until a person approves it, and drops it when they decline', async () => {
    const { token } = host.createToken({ scopes: ['files', 'destructive'] })
    const target = join(host.root, 'doomed.txt')
    await writeFile(target, 'x')
    const answers = [false, true]
    host.service.onEvent((event) => {
      if (event.type === 'approval-requested') {
        expect(event.request).toMatchObject({ tool: 'delete_path', transport: 'stdio' })
        host.service.respondApproval(event.request.id, answers.shift() ?? false)
      }
    })

    const declined = await callTool(token, 'delete_path', { machine: 'local', path: target })
    expect(declined.isError).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('x')
    expect(lastAudit()).toMatchObject({ outcome: 'approval-denied', approved: false })

    const approved = await callTool(token, 'delete_path', { machine: 'local', path: target })
    expect(approved.isError).toBe(false)
    await expect(readFile(target, 'utf8')).rejects.toThrow()
    expect(lastAudit()).toMatchObject({ outcome: 'ok', approved: true })
  })

  it('declines a destructive call nobody answers', async () => {
    const { token } = host.createToken({ scopes: ['files', 'destructive'] })
    const target = join(host.root, 'unanswered.txt')
    await writeFile(target, 'x')

    const reply = await callTool(token, 'delete_path', { machine: 'local', path: target })

    expect(reply.isError).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('x')
  })

  it('skips approval for a client set to never ask, except through the relay', async () => {
    host.service.updateSettings({ relayEnabled: true })
    const { token } = host.createToken({
      scopes: ['files', 'destructive'],
      approval: 'never',
      allowRelay: true
    })
    const first = join(host.root, 'first.txt')
    const second = join(host.root, 'second.txt')
    await writeFile(first, 'x')
    await writeFile(second, 'x')

    const direct = await callTool(token, 'delete_path', { machine: 'local', path: first })
    expect(direct.isError).toBe(false)

    const relayed = await callTool(
      token,
      'delete_path',
      { machine: 'local', path: second },
      'relay'
    )
    expect(relayed.isError).toBe(true)
    expect(await readFile(second, 'utf8')).toBe('x')
    expect(lastAudit()).toMatchObject({ transport: 'relay', outcome: 'approval-denied' })
  })

  it('asks before every command for a client set to approve commands', async () => {
    const { token } = host.createToken({ scopes: ['commands'], approval: 'commands' })
    const asked: string[] = []
    host.service.onEvent((event) => {
      if (event.type === 'approval-requested') {
        asked.push(event.request.summary)
        host.service.respondApproval(event.request.id, true)
      }
    })

    const reply = await callTool(token, 'run_command', { machine: 'local', command: 'echo ok' })

    expect(reply.text).toMatch(/^exit code 0/)
    expect(asked).toEqual(['echo ok'])
  })

  it('declines what a client has waiting when its token is revoked', async () => {
    const { token, clientId } = host.createToken({ scopes: ['files', 'destructive'] })
    const target = join(host.root, 'pending.txt')
    await writeFile(target, 'x')
    host.service.onEvent((event) => {
      if (event.type === 'approval-requested') {
        host.service.revokeClient(clientId)
      }
    })

    const reply = await callTool(token, 'delete_path', { machine: 'local', path: target })

    expect(reply.isError).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('x')
    expect(host.service.listApprovals()).toEqual([])
  })
})

describe('SealMcpService start_session with a machine allowlist', () => {
  it('starts a session only in a project or workspace on an allowed machine', async () => {
    const { token } = host.createToken({ scopes: ['sessions'], machines: ['local'] })

    const otherProject = await callTool(token, 'start_session', { prompt: 'go', project: 'models' })
    const otherWorkspace = await callTool(token, 'start_session', {
      prompt: 'go',
      worktree: 'path:/srv/models'
    })
    expect(otherProject.isError).toBe(true)
    expect(otherWorkspace.isError).toBe(true)
    expect(host.cliRuns).toEqual([])

    const allowed = await callTool(token, 'start_session', { prompt: 'go', worktree: 'w-1' })
    expect(allowed.isError).toBe(false)
    expect(host.cliRuns).toEqual([
      ['agent', 'launch', '--agent', 'claude', '--worktree', 'id:w-1', '--prompt', 'go', '--json']
    ])
  })

  it('starts a session on the allowed machine through the transport that machine uses', async () => {
    const { token } = host.createToken({ scopes: ['sessions'], machines: [GPU_MACHINE_ID] })

    const started = await callTool(token, 'start_session', {
      prompt: 'train',
      machine: 'gpu',
      project: 'models',
      name: 'run-1'
    })

    expect(started.isError).toBe(false)
    expect(host.cliRuns).toEqual([
      [
        'worktree',
        'create',
        '--project',
        'r-gpu',
        '--name',
        'run-1',
        '--agent',
        'claude',
        '--prompt',
        'train',
        '--host',
        'ssh:gpu',
        '--json'
      ]
    ])
  })
})

describe('SealMcpService limits and RPC-backed tools', () => {
  it('tells a client that calls too fast to slow down', async () => {
    const { token } = host.createToken({ callsPerMinute: 2 })

    await request(token, 'tools/list', {})
    await request(token, 'tools/list', {})
    const third = await request(token, 'tools/list', {})

    expect(third.error).toMatchObject({ code: -32000 })
    expect(lastAudit()).toMatchObject({ outcome: 'rate-limited' })
  })

  it('lists projects and workspaces through the runtime RPC, narrowed to allowed machines', async () => {
    const everything = host.createToken()
    const gpuOnly = host.createToken({ machines: [GPU_MACHINE_ID] })

    expect((await callTool(everything.token, 'list_projects', {})).text).toContain('r-local')
    const projects = await callTool(gpuOnly.token, 'list_projects', {})
    expect(projects.text).not.toContain('r-local')
    expect(JSON.parse(projects.text)).toEqual([
      { id: 'r-gpu', name: 'models', path: '/srv/models', kind: 'git', machine: GPU_MACHINE_ID }
    ])
    const workspaces = await callTool(everything.token, 'list_workspaces', { project: 'seal' })
    expect(workspaces.text).toContain('w-1')
    expect(host.rpcCalls).toContainEqual({
      method: 'worktree.list',
      params: { repo: 'id:r-local' }
    })
  })

  it('stops a session once approved and leaves it listed with its transcript', async () => {
    const { token } = host.createToken({ scopes: ['sessions', 'destructive'] })
    host.service.onEvent((event) => {
      if (event.type === 'approval-requested') {
        host.service.respondApproval(event.request.id, true)
      }
    })

    const reply = await callTool(token, 'stop_session', { session_id: 's-local' })

    expect(reply.isError).toBe(false)
    expect(host.rpcCalls).toEqual([
      {
        method: 'liveSessions.remove',
        params: { sessionIds: ['s-local'], stop: true, deleteTranscripts: false, keep: true }
      }
    ])
  })
})
