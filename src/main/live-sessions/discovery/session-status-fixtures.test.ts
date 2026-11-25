import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_DIR,
  CLAUDE_SHELL,
  CODEX_APP_SERVER,
  CODEX_SHELL,
  FIXTURES,
  scan,
  sourcedStatusOf,
  statusOf
} from './session-scan.test-fixture'

const RULE = '\u2500'.repeat(40)
const PERMISSION_SCREEN = [
  `\u256d${RULE}\u256e`,
  '\u2502 Bash command                              \u2502',
  '\u2502   pnpm vitest run src/checkout            \u2502',
  '\u2502 Do you want to proceed?                   \u2502',
  '\u2502 \u276f 1. Yes                                  \u2502',
  '\u2502   2. No, and tell Claude what to do differently (esc) \u2502',
  `\u2570${RULE}\u256f`
].join('\n')

const screenOf = (name: string) => readFileSync(join(FIXTURES, `${name}.screen`), 'utf8')

describe('status of a Claude Code session, from its transcript, process and screen', () => {
  it('working: a tool call has no result yet', async () => {
    expect(await statusOf('claude-working')).toEqual(['working', 'Bash: Run the checkout tests'])
  })

  it('waiting on a subagent that blocks the turn', async () => {
    const [session] = await scan('claude-waiting-foreground-subagent')
    expect([session.status, session.statusDetail]).toEqual([
      'waiting-subagent',
      'Waiting on 1 subagent'
    ])
    expect(session.activity?.subagents).toEqual([
      {
        id: 'a3f81c0e5b7d29416',
        title: 'Audit payments for unhandled rejections',
        agentType: 'general-purpose',
        model: 'sonnet',
        status: 'running',
        background: false,
        activity: 'Read: webhook.ts',
        startedAt: Date.parse('2026-11-13T10:00:12.000Z'),
        lastActivityAt: Date.parse('2026-11-13T10:00:13.000Z'),
        transcriptPath: `${CLAUDE_DIR}/claude-waiting-foreground-subagent/subagents/agent-a3f81c0e5b7d29416.jsonl`
      }
    ])
  })

  it('waiting on background subagents after its turn ended, not on the user', async () => {
    const [session] = await scan('claude-waiting-background-subagents')
    expect([session.status, session.statusDetail]).toEqual([
      'waiting-subagent',
      'Waiting on 2 subagents'
    ])
    expect(session.activity?.subagents.map((s) => [s.title, s.status, s.background])).toEqual([
      ['Migrate the cart store', 'running', true],
      ['Migrate the wishlist store', 'running', true]
    ])
  })

  it('waiting on the user once its background subagents reported back', async () => {
    const [session] = await scan('claude-background-subagents-finished')
    expect([session.status, session.statusDetail]).toEqual(['your-turn', null])
    expect(session.activity?.subagents.map((s) => s.status)).toEqual(['completed', 'completed'])
  })

  it('waiting on the background command its turn started before it ended', async () => {
    const [session] = await scan('claude-waiting-background-task')
    expect([session.status, session.statusDetail]).toEqual(['waiting-task', null])
    expect(session.activity?.tasks).toEqual([
      {
        id: 'bash_4',
        label: 'pnpm dev --port 4310',
        status: 'running',
        startedAt: Date.parse('2026-11-13T10:00:09.000Z'),
        summary: null
      }
    ])
  })

  it('waiting on the user once the background command ended, keeping how it ended', async () => {
    const [session] = await scan('claude-background-task-failed')
    expect(session.status).toBe('your-turn')
    expect(session.activity?.tasks.map((t) => [t.status, t.summary])).toEqual([
      ['failed', 'Background command "Start the dev server" failed with exit code 1']
    ])
  })

  it('needs permission: the pane shows a permission dialog', async () => {
    const [session] = await scan('claude-working', { screen: PERMISSION_SCREEN })
    expect([session.status, session.statusDetail, session.permission?.question]).toEqual([
      'needs-permission',
      'Allow Bash: Run the checkout tests?',
      'Do you want to proceed?'
    ])
    expect(session.permission?.options.map((o) => o.label)).toEqual([
      'Yes',
      'No, and tell Claude what to do differently'
    ])
  })

  it('waiting for input: it asked through its question tool', async () => {
    expect(await statusOf('claude-asks-question')).toEqual([
      'waiting-input',
      'Which limit should apply to anonymous clients?'
    ])
  })

  it('waiting for input: its reply ends in a question', async () => {
    expect(await statusOf('claude-reply-ends-in-question')).toEqual(['waiting-input', null])
  })

  it('waiting on the user: the turn ended on a statement and the agent sits at its prompt', async () => {
    const [session] = await scan('claude-idle')
    expect([session.status, session.statusDetail]).toEqual(['your-turn', null])
    expect(session.lastMessage).toBe(
      'Renamed OrderSummary to OrderReceipt in 23 files. Typecheck and tests pass.'
    )
  })

  it('done: the turn ended and the process is gone', async () => {
    expect(await statusOf('claude-idle', { alive: false, quietMs: 10 * 60_000 })).toEqual([
      'done',
      null
    ])
  })

  it('errored: the API refused the turn', async () => {
    const [status, detail] = await statusOf('claude-errored')
    expect(status).toBe('errored')
    expect(detail).toContain('API Error: 529')
  })

  it('a subagent whose session process is gone is stopped, not running', async () => {
    const [session] = await scan('claude-waiting-background-subagents', {
      alive: false,
      quietMs: 10 * 60_000
    })
    expect(session.status).toBe('done')
    expect(session.activity?.subagents.map((s) => s.status)).toEqual(['stopped', 'stopped'])
  })
})

describe('todo lists of a Claude Code session', () => {
  it('reads the newest TodoWrite list', async () => {
    const [session] = await scan('claude-todos')
    expect(session.activity?.todos).toEqual([
      {
        content: 'Add the gift_cards table',
        status: 'completed',
        activeForm: 'Adding the gift_cards table'
      },
      {
        content: 'Expose POST /gift-cards',
        status: 'in_progress',
        activeForm: 'Exposing POST /gift-cards'
      },
      { content: 'Redeem at checkout', status: 'pending', activeForm: 'Redeeming at checkout' }
    ])
  })

  it('follows TaskCreate and TaskUpdate', async () => {
    const [session] = await scan('claude-task-list')
    expect(session.activity?.todos.map((t) => [t.content, t.status])).toEqual([
      ['Add the gift_cards table', 'completed'],
      ['Expose POST /gift-cards', 'in_progress']
    ])
  })
})

describe('status of a Codex session, from its rollout and process', () => {
  it('working: a command is running', async () => {
    const [status, detail] = await statusOf('codex-working')
    expect(status).toBe('working')
    expect(detail).toContain('Bash: bash -lc rg -n')
  })

  it('needs permission: it asked to run a command', async () => {
    expect(await statusOf('codex-needs-permission')).toEqual([
      'needs-permission',
      'Allow bash -lc rm -rf dist .cache?'
    ])
  })

  it('waiting on the user: the turn completed on a statement', async () => {
    expect(await statusOf('codex-idle')).toEqual(['your-turn', null])
  })

  it('waiting for input: the turn completed on a question', async () => {
    expect(await statusOf('codex-asks-question')).toEqual(['waiting-input', null])
  })

  it('errored: the stream failed', async () => {
    const [status, detail] = await statusOf('codex-errored')
    expect(status).toBe('errored')
    expect(detail).toContain('Rate limit reached')
  })

  it('reads its plan', async () => {
    const [session] = await scan('codex-plan')
    expect(session.activity?.todos).toEqual([
      { content: 'Add a cursor to the orders query', status: 'completed' },
      { content: 'Return next_cursor from GET /orders', status: 'in_progress' },
      { content: 'Document the new parameters', status: 'pending' }
    ])
  })

  it('waiting on its helper threads, which are its subagents and not sessions of their own', async () => {
    const sessions = await scan('codex-waiting-helpers', {
      beside: [
        'codex-waiting-helpers.helper-auth_reviewer',
        'codex-waiting-helpers.helper-billing_reviewer'
      ]
    })
    expect(sessions).toHaveLength(1)
    expect([sessions[0].status, sessions[0].statusDetail]).toEqual([
      'waiting-subagent',
      'Waiting on 1 subagent'
    ])
    expect(sessions[0].activity?.subagents.map((s) => [s.title, s.agentType, s.status])).toEqual([
      ['auth_reviewer', 'explorer', 'running'],
      ['billing_reviewer', 'explorer', 'completed']
    ])
  })
})

// Transcripts, screens and process trees recorded from real Claude Code 2.1.325 and Codex 0.169.0
// sessions (see docs/design/agent-status.md); only paths and prompts were rewritten.
describe('status of recorded Claude Code sessions, where the transcript alone cannot tell', () => {
  it('running shell: the Bash call has no result and the shell it started still runs', async () => {
    expect(
      await sourcedStatusOf('live-claude-shell-pending', {
        quietMs: 60_000,
        children: CLAUDE_SHELL('01:00')
      })
    ).toEqual(['running-shell', 'process', 'Bash: Run the long script'])
  })

  it('working: the command started a moment ago', async () => {
    expect(
      await sourcedStatusOf('live-claude-shell-pending', {
        quietMs: 2_000,
        children: CLAUDE_SHELL('00:02')
      })
    ).toEqual(['working', 'transcript', 'Bash: Run the long script'])
  })

  it('working: the host lists no processes, so a quiet Bash call proves nothing', async () => {
    expect(await sourcedStatusOf('live-claude-shell-pending', { quietMs: 60_000 })).toEqual([
      'working',
      'transcript',
      'Bash: Run the long script'
    ])
  })

  it('waiting for approval: the same Bash call with no command under the agent and no pane to read', async () => {
    expect(
      await sourcedStatusOf('live-claude-approval-pending', { quietMs: 6_000, children: [] })
    ).toEqual(['needs-permission', 'process', 'Allow Bash: Remove the build output?'])
  })

  it("working: a shell older than the call (the user's own) is not its command, and 2 s is too soon to call it a prompt", async () => {
    expect(
      await sourcedStatusOf('live-claude-approval-pending', {
        quietMs: 2_000,
        children: ['4150 4100 12:00 shell bash']
      })
    ).toEqual(['working', 'transcript', 'Bash: Remove the build output'])
  })

  it('auto mode reviews a call before it runs or asks: 10 s is still working, 25 s is a prompt', async () => {
    const at = async (quietMs: number) =>
      (await sourcedStatusOf('live-claude-shell-pending', { quietMs, children: [] })).slice(0, 2)
    expect(await at(10_000)).toEqual(['working', 'transcript'])
    expect(await at(25_000)).toEqual(['needs-permission', 'process'])
  })

  it('waiting for approval: the pane shows a prompt whose options carry no numbers', async () => {
    const [session] = await scan('live-claude-shell-pending', {
      quietMs: 4_000,
      children: [],
      screen: screenOf('live-claude-approval-unnumbered')
    })
    expect([session.status, session.statusSource, session.statusDetail]).toEqual([
      'needs-permission',
      'screen',
      'Allow Bash: Run the long script?'
    ])
    // Nothing to answer by number, so no answer buttons are offered.
    expect(session.permission).toBeNull()
  })

  it('waiting for approval: a dialog stands over the turn', async () => {
    expect(
      await sourcedStatusOf('live-claude-shell-pending', {
        quietMs: 4_000,
        children: [],
        screen: screenOf('live-claude-auto-mode-dialog')
      })
    ).toEqual(['needs-permission', 'screen', "Auto mode can't check actions in this session"])
  })

  it('working: the pane still says "esc to interrupt" though the transcript reads as finished', async () => {
    expect(
      (await sourcedStatusOf('claude-idle', { screen: screenOf('live-claude-shell-busy') })).slice(
        0,
        2
      )
    ).toEqual(['working', 'screen'])
  })

  it('errored: the API refused the turn, which then closed like any other', async () => {
    const [status, , detail] = await sourcedStatusOf('live-claude-api-error')
    expect(status).toBe('errored')
    expect(detail).toContain('API Error: Repeated 529 Overloaded errors.')
  })

  it('waiting on the user: a reply that may or may not ask is not called a question without the model', async () => {
    const [session] = await scan('live-claude-unclear-reply')
    expect(session.lastMessage).toBe(
      'The deploy script can target staging or production. Should I go ahead with staging? I have not changed anything yet.'
    )
    expect([session.status, session.statusSource]).toEqual(['your-turn', 'transcript'])
  })
})

describe('status of recorded Codex sessions', () => {
  it('running shell: an exec cell has no output and its command runs under the app-server', async () => {
    expect(
      await sourcedStatusOf('live-codex-exec-pending', {
        quietMs: 12_000,
        processes: [CODEX_APP_SERVER],
        children: CODEX_SHELL('00:12')
      })
    ).toEqual(['running-shell', 'process', 'Bash: ./long.sh 70'])
  })

  it('waiting on a task: the command outlived its exec call and the agent polls it', async () => {
    expect(
      await sourcedStatusOf('live-codex-poll-pending', {
        quietMs: 10_000,
        processes: [CODEX_APP_SERVER],
        children: CODEX_SHELL('00:40')
      })
    ).toEqual(['waiting-task', 'process', 'Bash: ./long.sh 70'])
  })

  it('waiting for approval: an exec cell has no output and nothing runs under the app-server', async () => {
    expect(
      await sourcedStatusOf('live-codex-exec-pending', {
        quietMs: 6_000,
        processes: [CODEX_APP_SERVER],
        children: ['4301 4300 20:00 other codex-code-mode-host']
      })
    ).toEqual(['needs-permission', 'process', 'Allow Bash: ./long.sh 70?'])
  })

  it('asking a question: its question tool has no answer, whatever the footer says', async () => {
    expect(
      await sourcedStatusOf('live-codex-ask-pending', { screen: screenOf('live-codex-question') })
    ).toEqual(['waiting-input', 'transcript', 'Which database should the migration target?'])
  })

  it('errored: the turn completed with an error', async () => {
    expect(await statusOf('live-codex-failed-turn')).toEqual([
      'errored',
      'Missing environment variable: `OPENAI_API_KEY`.'
    ])
  })
})
