import { describe, expect, it, vi } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type { SessionSummariesListResult } from '../../shared/session-summaries/session-summary-contracts'
import { LiveSessionSummaries, type LiveSessionSummariesDeps } from './live-session-summaries'
import type { SessionSummaryView } from './session-summarizer'

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local', connection: 'local' },
    origin: 'external',
    cwd: '/repo',
    project: 'repo',
    title: 'Fix login',
    status: 'waiting-input',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath: '/t.jsonl',
    inputRoutes: [{ kind: 'tmux', target: '%1' }],
    permission: null,
    ...overrides
  }
}

const upsert = (next: LiveSession) => ({ type: 'upsert' as const, revision: 1, session: next })

function harness(
  options: {
    serverSummaries?: (executionHostId: string) => Promise<SessionSummariesListResult | null>
  } = {}
) {
  const calls: string[] = []
  const views = new Map<string, SessionSummaryView>()
  const summarizer: LiveSessionSummariesDeps['summarizer'] = {
    request: (key, message) => void calls.push(`request ${key} ${message}`),
    clear: (key) => void calls.push(`clear ${key}`),
    forget: (key) => void calls.push(`forget ${key}`),
    view: (key) => views.get(key) ?? null
  }
  const lastAssistantText = vi.fn(async () => 'Patched the middleware and added a test.')
  const onChange = vi.fn()
  const live = new LiveSessionSummaries({
    summarizer,
    lastAssistantText,
    paneView: (paneKey) =>
      paneKey === 'pane-1' ? { text: 'From the pane.', pending: false } : null,
    serverSummaries: options.serverSummaries,
    onChange,
    setTimer: () => ({ cancel: () => {} }),
    now: () => 10_000
  })
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  return { live, calls, views, lastAssistantText, onChange, settle }
}

describe('LiveSessionSummaries', () => {
  it('summarizes the last assistant message when a session starts waiting for input', async () => {
    const h = harness()

    h.live.observe(upsert(session()))
    await h.settle()

    expect(h.lastAssistantText).toHaveBeenCalledWith('local:claude:abc')
    expect(h.calls).toEqual([
      'request live:local:claude:abc Patched the middleware and added a test.'
    ])
  })

  it('reads the transcript once per stop, however often the session is republished', async () => {
    const h = harness()

    h.live.observe(upsert(session()))
    await h.settle()
    h.live.observe(upsert(session({ title: 'Renamed' })))
    h.live.observe(upsert(session({ summary: 'Patched the middleware.' })))
    await h.settle()
    expect(h.lastAssistantText).toHaveBeenCalledTimes(1)

    h.live.observe(upsert(session({ lastActivityAt: 2_000 })))
    await h.settle()
    expect(h.lastAssistantText).toHaveBeenCalledTimes(2)
  })

  it('summarizes a session parked on a subagent and clears it when plain work resumes', async () => {
    const h = harness()

    h.live.observe(upsert(session({ status: 'working', statusDetail: 'Task: run the test suite' })))
    await h.settle()
    h.live.observe(upsert(session({ status: 'working', statusDetail: 'Bash: pnpm test' })))

    expect(h.calls).toEqual([
      'request live:local:claude:abc Patched the middleware and added a test.',
      'clear live:local:claude:abc'
    ])
  })

  it('keeps the summary through a permission prompt and forgets a session that ended', async () => {
    const h = harness()
    h.live.observe(upsert(session()))
    await h.settle()

    h.live.observe(upsert(session({ status: 'needs-permission' })))
    h.live.observe(upsert(session({ status: 'done', alive: false })))

    expect(h.calls).toEqual([
      'request live:local:claude:abc Patched the middleware and added a test.',
      'forget live:local:claude:abc'
    ])
  })

  it('leaves a Seal pane to its hook rows and shows the pane summary', async () => {
    const h = harness()
    const pane = session({ inputRoutes: [{ kind: 'seal-pane', paneKey: 'pane-1' }] })

    h.live.observe(upsert(pane))
    await h.settle()

    expect(h.lastAssistantText).not.toHaveBeenCalled()
    expect(h.live.decorate(pane).summary).toBe('From the pane.')
  })

  it('shows its own summary, then pending, on the published session', () => {
    const h = harness()
    const waiting = session()

    h.views.set('live:local:claude:abc', { text: null, pending: true })
    expect(h.live.decorate(waiting)).toEqual({ ...waiting, summaryPending: true })

    h.views.set('live:local:claude:abc', { text: 'Patched the middleware.', pending: false })
    expect(h.live.decorate(waiting)).toEqual({ ...waiting, summary: 'Patched the middleware.' })
  })

  it("shows a paired server's summary instead of summarizing its session again", async () => {
    const serverSummaries = vi.fn(async () => ({
      status: { enabled: true, configured: true, pausedUntil: null },
      sessions: [
        {
          paneKey: 'server-pane',
          agentType: 'claude',
          providerSessionId: 'abc',
          text: 'Needs approval to deploy.',
          pending: false
        }
      ]
    }))
    const h = harness({ serverSummaries })
    const remote = session({
      id: 'kessel:claude:abc',
      machine: {
        hostId: 'kessel',
        label: 'kessel-ml',
        kind: 'remote',
        connection: 'server',
        executionHostId: 'runtime:env-kessel'
      }
    })

    h.live.observe(upsert(remote))
    await h.settle()

    expect(serverSummaries).toHaveBeenCalledWith('runtime:env-kessel')
    expect(h.lastAssistantText).not.toHaveBeenCalled()
    expect(h.calls).toEqual(['forget live:kessel:claude:abc'])
    expect(h.onChange).toHaveBeenCalledTimes(1)
    expect(h.live.decorate(remote).summary).toBe('Needs approval to deploy.')
  })

  it('summarizes a server session itself when that server has no provider', async () => {
    const h = harness({
      serverSummaries: async () => ({
        status: { enabled: true, configured: false, pausedUntil: null },
        sessions: []
      })
    })
    const remote = session({
      id: 'kessel:claude:abc',
      machine: {
        hostId: 'kessel',
        label: 'kessel-ml',
        kind: 'remote',
        connection: 'server',
        executionHostId: 'runtime:env-kessel'
      }
    })

    h.live.observe(upsert(remote))
    await h.settle()

    expect(h.calls).toEqual([
      'request live:kessel:claude:abc Patched the middleware and added a test.'
    ])
  })
})
