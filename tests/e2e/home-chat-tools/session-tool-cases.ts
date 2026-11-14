import { expect } from '@stablyai/playwright-test'
import {
  FAKE_CLAUDE_LAUNCH_FILE,
  installFakeClaude,
  processRuns,
  seedClosedClaudeSession,
  startFakeClaudeProcess,
  stopProcess
} from './fake-agent-sessions'
import { z } from 'zod'
import { exists, expectError, expectOk, readBack, seedFile, workDir } from './tool-case-support'
import type { Target, ToolEnv, ToolCases } from './tool-case-types'

const SESSION_IDS: Record<Target['key'], string> = {
  local: '11111111-1111-4111-8111-111111111111',
  'ssh-zsh': '22222222-2222-4222-8222-222222222222',
  'ssh-bash': '33333333-3333-4333-8333-333333333333',
  'ssh-fish': '44444444-4444-4444-8444-444444444444',
  'seal-server': '55555555-5555-4555-8555-555555555555'
}
const TURNS = [
  { ask: 'Fix the failing build', answer: 'The build is green again.' },
  { ask: 'Now run the "slow" tests', answer: 'All 12 slow tests pass.' }
]
const FOLLOW_UP =
  'Say "hi" to $USER & co — it\'s `100%` done?\nSecond line: 日本語 ✓ *.txt $(echo not-run)'

/** Sessions name this computer by its host name alone. */
function sessionLabel(target: Target): string {
  return target.label.replace(' (this computer)', '')
}

/** The id list_sessions shows for the session a provider id or pid belongs to. */
function sessionIdIn(listing: string, marker: string): string {
  const id = listing
    .split('\n')
    .find((line) => line.startsWith('- ') && line.includes(marker))
    ?.slice(2)
  expect(id, `no session with ${marker} in:\n${listing}`).toBeTruthy()
  return id!
}

function closedSession(target: Target): { id: string; cwd: string; path: string } {
  const id = SESSION_IDS[target.key]
  const cwd = `${workDir(target)}/session project`
  installFakeClaude(target)
  return { id, cwd, path: seedClosedClaudeSession(target, { id, cwd, turns: TURNS }) }
}

async function listSessions(env: ToolEnv, target: Target): Promise<void> {
  const closed = closedSession(target)
  const liveCwd = `${workDir(target)}/live project`
  const pid = startFakeClaudeProcess(target, liveCwd)
  try {
    const { outcomes } = await env.call([
      { name: 'list_sessions', args: { machine: target.machine } },
      { name: 'list_sessions', args: { machine: target.machine, include_done: true } },
      { name: 'list_sessions', args: { machine: 'no-such-machine' } }
    ])
    const active = expectOk(outcomes[0])
    expect(active).not.toContain(closed.id)
    const liveId = sessionIdIn(active, `pid-${pid}`)
    expect(active).toContain(
      `- ${liveId}\n  claude on ${sessionLabel(target)} (${target.id}) in ${liveCwd}\n  waiting-input, active `
    )
    const all = expectOk(outcomes[1])
    const closedId = sessionIdIn(all, closed.id)
    expect(all).toContain(
      `- ${closedId}\n  claude on ${sessionLabel(target)} (${target.id}) in ${closed.cwd}\n  done, active `
    )
    expect(all).toContain('outside Seal, process not running, can be taken over')
    expect(all).toContain(`title: ${TURNS[0].ask}`)
    expectError(outcomes[2])
  } finally {
    stopProcess(target, pid)
  }
}

async function findClosed(env: ToolEnv, target: Target): Promise<string> {
  const closed = closedSession(target)
  const { outcomes } = await env.call([
    { name: 'list_sessions', args: { machine: target.machine, include_done: true } }
  ])
  return sessionIdIn(expectOk(outcomes[0]), closed.id)
}

async function readSession(env: ToolEnv, target: Target): Promise<void> {
  const sessionId = await findClosed(env, target)
  const { outcomes } = await env.call([
    { name: 'read_session', args: { session_id: sessionId } },
    { name: 'read_session', args: { session_id: sessionId, limit: 1 } },
    { name: 'read_session', args: { session_id: 'no-such-session' } }
  ])
  expect(expectOk(outcomes[0])).toBe(
    'user: Fix the failing build\n\nassistant: The build is green again.\n\nuser: Now run the "slow" tests\n\nassistant: All 12 slow tests pass.'
  )
  expect(expectOk(outcomes[1])).toBe('assistant: All 12 slow tests pass.')
  expect(expectError(outcomes[2])).toContain('No session no-such-session')
}

async function messageSession(env: ToolEnv, target: Target): Promise<void> {
  const closed = closedSession(target)
  const livePid = startFakeClaudeProcess(target, `${workDir(target)}/live project`)
  let closedId = ''
  try {
    const unreachable = await env.call([
      { name: 'list_sessions', args: { machine: target.machine, include_done: true } },
      (answers) => ({
        name: 'message_session',
        args: { session_id: sessionIdIn(answers[0] ?? '', `pid-${livePid}`), text: 'hello' }
      })
    ])
    closedId = sessionIdIn(expectOk(unreachable.outcomes[0]), closed.id)
    // A terminal nobody can type into: Seal says so instead of reporting the message as sent.
    expect(expectError(unreachable.outcomes[1])).toContain('Seal cannot type into this session')
  } finally {
    stopProcess(target, livePid)
  }
  const sent = await env.call([
    { name: 'message_session', args: { session_id: closedId, text: FOLLOW_UP } },
    { name: 'message_session', args: { session_id: 'no-such-session', text: 'hello' } }
  ])
  expect(expectOk(sent.outcomes[0])).toMatch(
    new RegExp(`^(Delivered to|Handed to) ${closedId} through its resume`)
  )
  expect(expectError(sent.outcomes[1])).toContain('No session no-such-session')
  await expect
    .poll(() => readBack(target, closed.path).toString('utf8'), { timeout: 30_000 })
    .toContain('fake claude heard: ')
  const { outcomes } = await env.call([
    { name: 'read_session', args: { session_id: closedId, limit: 2 } }
  ])
  expect(expectOk(outcomes[0])).toBe(
    `user: ${FOLLOW_UP}\n\nassistant: fake claude heard: ${FOLLOW_UP}`
  )
}

async function takeOverSession(env: ToolEnv, target: Target): Promise<void> {
  const closed = closedSession(target)
  const cwd = `${workDir(target)}/live project`
  const bare = startFakeClaudeProcess(target, cwd)
  const resumed = startFakeClaudeProcess(target, closed.cwd, `--resume ${closed.id}`)
  try {
    const listed = await env.call([
      { name: 'list_sessions', args: { machine: target.machine, include_done: true } }
    ])
    const listing = expectOk(listed.outcomes[0])
    const bareId = sessionIdIn(listing, `pid-${bare}`)
    const resumedId = sessionIdIn(listing, closed.id)
    expect(listing).toContain('outside Seal, can be taken over')

    const refused = await env.call([
      { name: 'take_over_session', args: { session_id: bareId } },
      { name: 'take_over_session', args: { session_id: 'no-such-session' } }
    ])
    expect(refused.outcomes[0].askedApproval).toBe(true)
    expect(expectError(refused.outcomes[0])).toContain('cannot be taken over yet')
    expect(expectError(refused.outcomes[1])).toContain('No session no-such-session')

    const declined = await env.call(
      [{ name: 'take_over_session', args: { session_id: resumedId } }],
      { approve: false }
    )
    expect(declined.outcomes[0].status).toBe('denied')
    expect(processRuns(target, resumed)).toBe(true)

    // Reopening needs a Seal workspace on the session's machine; only this computer has one here.
    if (target.key !== 'local') {
      return
    }
    const taken = await env.call([{ name: 'take_over_session', args: { session_id: resumedId } }])
    expect(taken.outcomes[0].askedApproval).toBe(true)
    expect(expectOk(taken.outcomes[0])).toContain(`reopen ${resumedId} in a Seal pane`)
    await expect.poll(() => processRuns(target, resumed), { timeout: 30_000 }).toBe(false)
    expect(processRuns(target, bare)).toBe(true)
  } finally {
    stopProcess(target, bare)
    stopProcess(target, resumed)
  }
}

const START_PROMPT =
  'Explain "this" repo to $USER — it\'s `quoted`; *.md & more\nsecond line: 日本語 ✓'
const worktreeList = z.object({
  result: z.object({ worktrees: z.array(z.object({ id: z.string(), path: z.string() })) })
})
const launchRecord = z.object({ args: z.array(z.string()), cwd: z.string() })

/** Starts a session in a workspace of the machine and checks the agent got the prompt as given. */
async function startIn(
  env: ToolEnv,
  target: Target,
  folder: string,
  scope: readonly string[]
): Promise<void> {
  installFakeClaude(target)
  // Seal's panes run the user's shell, which finds the agent CLI the way the user set it up.
  seedFile(target, `${target.home}/.zshenv`, 'export PATH="$HOME/bin:$PATH"\n')
  const launchFile = `${target.home}/${FAKE_CLAUDE_LAUNCH_FILE}`
  const { outcomes } = await env.call([
    { name: 'seal_cli', args: { args: ['worktree', 'list', ...scope, '--json'] } },
    (answers) => {
      const listing = (answers[0] ?? '').slice((answers[0] ?? '').indexOf('{'))
      const worktree = worktreeList
        .parse(JSON.parse(listing))
        .result.worktrees.find((candidate) => candidate.path === folder)
      return {
        name: 'start_session',
        args: {
          machine: target.machine,
          worktree: worktree?.id ?? 'missing',
          agent: 'claude',
          prompt: START_PROMPT
        }
      }
    }
  ])
  expect(expectOk(outcomes[1])).toMatch(
    new RegExp(`^Started a claude session on ${target.label.replace(/[()]/g, '\\$&')}`)
  )
  await expect.poll(() => exists(target, launchFile), { timeout: 60_000 }).toBe(true)
  const launched = launchRecord.parse(JSON.parse(readBack(target, launchFile).toString('utf8')))
  expect(launched.cwd).toBe(folder)
  expect(launched.args.at(-1)).toBe(START_PROMPT)
}

/** A new agent session in a Seal pane: in the project here, in a folder workspace on the Seal server. */
async function startSession(env: ToolEnv, target: Target): Promise<void> {
  if (target.key === 'local') {
    await startIn(env, target, env.projectPath, [])
  } else {
    const folder = `${target.home}/seal-e2e-server-project`
    target.sh(`mkdir -p '${folder}'`)
    const scope = ['--environment', target.label]
    const added = await env.call([
      {
        name: 'seal_cli',
        args: { args: ['repo', 'add', '--path', folder, '--kind', 'folder', ...scope, '--json'] }
      }
    ])
    expectOk(added.outcomes[0])
    await startIn(env, target, folder, scope)
  }
  const refused = await env.call([
    { name: 'start_session', args: { machine: target.machine, prompt: 'no place to run' } },
    {
      name: 'start_session',
      args: { machine: target.machine, worktree: 'no-such-worktree', prompt: 'hello' }
    }
  ])
  expect(expectError(refused.outcomes[0])).toContain('start_session needs worktree')
  expect(expectError(refused.outcomes[1])).toContain('Seal could not start the session')
}

export const SESSION_TOOL_CASES: ToolCases = {
  list_sessions: { scope: 'each-machine', run: listSessions },
  read_session: { scope: 'each-machine', run: readSession },
  message_session: { scope: 'each-machine', run: messageSession },
  take_over_session: { scope: 'each-machine', run: takeOverSession },
  // Seal hosts sessions in its workspaces; the plain SSH accounts here have none.
  start_session: { scope: 'some-machines', on: ['local', 'seal-server'], run: startSession }
}
