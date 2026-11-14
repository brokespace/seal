// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import {
  LIVE_SESSION_MENU_ITEM_IDS,
  removeRequestFor,
  type LiveSessionMenuContext,
  type LiveSessionMenuEffects,
  type LiveSessionMenuItemId
} from './live-session-menu'
import { DROPDOWN_MENU_KIT, LiveSessionMenuItemsView } from './LiveSessionMenuItems'

afterEach(cleanup)

const SESSION_ID = 'local:claude:04186322-14da-4a67-890c-c5f4a754e99f'

const session: LiveSession = {
  id: SESSION_ID,
  provider: 'claude',
  providerSessionId: '04186322-14da-4a67-890c-c5f4a754e99f',
  machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
  origin: 'seal',
  cwd: '/srv/shop',
  project: 'shop',
  title: 'Fix the coupon bug',
  status: 'needs-permission',
  statusSource: 'screen',
  statusDetail: 'Allow Bash?',
  lastActivityAt: 1,
  startedAt: 0,
  alive: true,
  pid: 4100,
  transcriptPath: '/home/dev/.claude/projects/-srv-shop/04186322-14da-4a67-890c-c5f4a754e99f.jsonl',
  inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-1:0' }],
  permission: { promptId: 'p1', question: 'Allow Bash?', options: [{ id: 'yes', label: 'Yes' }] },
  activity: {
    subagents: [
      {
        id: 'a1',
        title: 'Audit payments',
        agentType: 'general-purpose',
        model: null,
        status: 'running',
        background: true,
        activity: null,
        startedAt: 0,
        lastActivityAt: 0,
        transcriptPath: null
      }
    ],
    tasks: [],
    todos: [{ content: 'Write the fix', status: 'in_progress' }]
  }
}

const context: LiveSessionMenuContext = {
  worktreeId: 'repo-1::/srv/shop',
  swapAccounts: [
    { key: 'claude:personal', label: 'personal', current: true },
    { key: 'claude:work', label: 'work', current: false }
  ],
  canTakeOver: true
}

/** What selecting each item must do, and nothing else. */
const EXPECTED: Record<LiveSessionMenuItemId, [keyof LiveSessionMenuEffects, ...unknown[]]> = {
  open: ['open', SESSION_ID, 'preview'],
  'open-new-tab': ['open', SESSION_ID, 'tab'],
  'open-split': ['open', SESSION_ID, 'split'],
  'send-message': ['askMessage', session],
  'answer-permission': ['focus', SESSION_ID, 'permission'],
  'view-subagents': ['focus', SESSION_ID, 'subagents'],
  'view-tasks': ['focus', SESSION_ID, 'tasks'],
  'view-reasoning': ['focus', SESSION_ID, 'reasoning'],
  rename: ['askRename', session],
  pin: ['setPinned', session, true],
  'copy-session-id': ['copy', '04186322-14da-4a67-890c-c5f4a754e99f', 'session-id'],
  'copy-resume-command': [
    'copy',
    "cd '/srv/shop' && claude --resume '04186322-14da-4a67-890c-c5f4a754e99f'",
    'resume-command'
  ],
  'swap-account': ['swapAccount', session, 'claude:work'],
  'take-over': ['takeOver', session],
  'open-worktree': ['openWorktree', 'repo-1::/srv/shop'],
  'open-machine': ['openMachine', session],
  'reveal-transcript': ['revealTranscript', session],
  stop: ['confirm', 'stop', [session]],
  'stop-and-remove': ['confirm', 'stop-and-remove', [session]],
  remove: ['confirm', 'remove', [session]],
  'delete-with-transcripts': ['confirm', 'delete-with-transcripts', [session]]
}

/** Effects that only note what was asked of them. */
function recordingEffects(calls: unknown[][] = []): LiveSessionMenuEffects {
  const record =
    (name: keyof LiveSessionMenuEffects) =>
    (...args: unknown[]) => {
      calls.push([name, ...args])
    }
  return {
    open: record('open'),
    focus: record('focus'),
    askRename: record('askRename'),
    askMessage: record('askMessage'),
    setPinned: record('setPinned'),
    copy: record('copy'),
    swapAccount: record('swapAccount'),
    takeOver: record('takeOver'),
    openWorktree: record('openWorktree'),
    openMachine: record('openMachine'),
    revealTranscript: record('revealTranscript'),
    confirm: record('confirm')
  }
}

function openMenu() {
  const calls: unknown[][] = []
  const effects = recordingEffects(calls)
  render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>Session</DropdownMenuTrigger>
      <DropdownMenuContent>
        <LiveSessionMenuItemsView
          session={session}
          context={context}
          kit={DROPDOWN_MENU_KIT}
          effects={effects}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const item = (id: string) =>
    document.querySelector<HTMLElement>(`[data-live-session-menu-item="${id}"]`)
  return { calls, item }
}

describe('session menu', () => {
  it.each(LIVE_SESSION_MENU_ITEM_IDS)('%s runs its one handler', (id) => {
    vi.stubGlobal('navigator', { userAgent: 'X11; Linux x86_64' })
    const { calls, item } = openMenu()
    const element = item(id)
    expect(element?.getAttribute('aria-disabled')).not.toBe('true')
    if (id === 'swap-account') {
      // The accounts sit in a submenu, opened here the way the keyboard opens it.
      fireEvent.keyDown(element!, { key: 'ArrowRight' })
      fireEvent.click(document.querySelector('[data-live-session-account="claude:work"]')!)
    } else {
      fireEvent.click(element!)
    }
    expect(calls).toEqual([EXPECTED[id]])
  })

  it('offers nothing a session cannot do', () => {
    const quiet: LiveSession = {
      ...session,
      alive: false,
      permission: null,
      activity: { subagents: [], tasks: [], todos: [] },
      inputRoutes: [],
      transcriptPath: null,
      providerSessionId: 'pid-4100'
    }
    const { rerender } = render(<div />)
    rerender(
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>Session</DropdownMenuTrigger>
        <DropdownMenuContent>
          <LiveSessionMenuItemsView
            session={quiet}
            context={{ worktreeId: null, swapAccounts: [], canTakeOver: false }}
            kit={DROPDOWN_MENU_KIT}
            effects={recordingEffects()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const disabled = [...document.querySelectorAll('[data-live-session-menu-item]')]
      .filter((element) => element.getAttribute('aria-disabled') === 'true')
      .map((element) => element.getAttribute('data-live-session-menu-item'))
    expect(disabled).toEqual([
      'send-message',
      'answer-permission',
      'view-subagents',
      'view-tasks',
      'copy-resume-command',
      'swap-account',
      'take-over',
      'open-worktree',
      'reveal-transcript',
      'stop',
      'stop-and-remove',
      'delete-with-transcripts'
    ])
  })
})

describe('what a confirmed action asks for', () => {
  const running = { id: 'a', alive: true }
  const ended = { id: 'b', alive: false }

  it('stops without hiding, hides without stopping, and stops before deleting files', () => {
    expect(removeRequestFor('stop', [running])).toEqual({
      sessionIds: ['a'],
      stop: true,
      deleteTranscripts: false,
      keep: true
    })
    expect(removeRequestFor('stop-and-remove', [running])).toEqual({
      sessionIds: ['a'],
      stop: true,
      deleteTranscripts: false
    })
    expect(removeRequestFor('remove', [running, ended])).toEqual({
      sessionIds: ['a', 'b'],
      stop: false,
      deleteTranscripts: false
    })
    expect(removeRequestFor('delete-with-transcripts', [running, ended])).toEqual({
      sessionIds: ['a', 'b'],
      stop: true,
      deleteTranscripts: true
    })
    expect(removeRequestFor('delete-with-transcripts', [ended])).toEqual({
      sessionIds: ['b'],
      stop: false,
      deleteTranscripts: true
    })
  })
})
