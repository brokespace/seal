import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionPaneKeyOf } from '../../../../shared/live-sessions/live-session-surface'
import { isLiveSessionUnread, LiveSessionMarksStore } from './live-session-marks-store'
import { joinLiveSessionMarksWithTabAttention } from './live-session-tab-attention-join'
import { sampleLiveSession } from './live-session.test-fixture'

const CLI_PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const ACKNOWLEDGED_NOW = 2000

const cliSession = sampleLiveSession('local:claude:cli', {
  status: 'your-turn',
  lastActivityAt: 1000,
  surface: { kind: 'cli', paneKey: CLI_PANE_KEY }
})
const chatSession = sampleLiveSession('local:claude:chat', {
  status: 'your-turn',
  lastActivityAt: 1000,
  surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'structured-agent-session-chat-1' }
})
const CHAT_PANE_KEY = liveSessionPaneKeyOf(chatSession)!

type TabAttention = {
  acknowledgedAgentsByPaneKey: Record<string, number>
  unreadAgentCompletionPanes: Record<string, true>
  agentStatusByPaneKey: Record<string, true>
}

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T) => {
      value = next
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

function startJoin(options: {
  sessions: LiveSession[]
  seenAt: Record<string, number>
  attention?: Partial<TabAttention>
  now?: () => number
}) {
  const sessions = observable<readonly LiveSession[]>(options.sessions)
  const attention = observable<TabAttention>({
    acknowledgedAgentsByPaneKey: {},
    unreadAgentCompletionPanes: {},
    agentStatusByPaneKey: {},
    ...options.attention
  })
  const marks = new LiveSessionMarksStore(options.seenAt)
  const acknowledged: string[][] = []
  const stop = joinLiveSessionMarksWithTabAttention({
    sessions,
    tabAttention: {
      get: attention.get,
      subscribe: attention.subscribe,
      acknowledgeAgents: (paneKeys) => {
        acknowledged.push(paneKeys)
        const { acknowledgedAgentsByPaneKey, unreadAgentCompletionPanes } = attention.get()
        attention.set({
          ...attention.get(),
          acknowledgedAgentsByPaneKey: {
            ...acknowledgedAgentsByPaneKey,
            ...Object.fromEntries(paneKeys.map((paneKey) => [paneKey, ACKNOWLEDGED_NOW]))
          },
          unreadAgentCompletionPanes: Object.fromEntries(
            Object.entries(unreadAgentCompletionPanes).filter(([key]) => !paneKeys.includes(key))
          )
        })
      }
    },
    marks,
    now: options.now
  })
  const acknowledgeTab = (paneKey: string, at: number): void =>
    attention.set({
      ...attention.get(),
      acknowledgedAgentsByPaneKey: { ...attention.get().acknowledgedAgentsByPaneKey, [paneKey]: at }
    })
  const raiseCompletionMarker = (paneKey: string): void =>
    attention.set({
      ...attention.get(),
      unreadAgentCompletionPanes: { ...attention.get().unreadAgentCompletionPanes, [paneKey]: true }
    })
  return { sessions, attention, marks, acknowledged, acknowledgeTab, raiseCompletionMarker, stop }
}

describe('joinLiveSessionMarksWithTabAttention', () => {
  it('marks a CLI session seen once its tab was viewed after it finished', () => {
    const { marks, acknowledgeTab } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 }
    })
    expect(isLiveSessionUnread(cliSession, marks.getState().seenAt)).toBe(true)

    acknowledgeTab(CLI_PANE_KEY, 1500)

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 1000 })
    expect(isLiveSessionUnread(cliSession, marks.getState().seenAt)).toBe(false)
  })

  it('marks a chat session seen once its tab was viewed after it finished', () => {
    const { marks, acknowledgeTab } = startJoin({
      sessions: [chatSession],
      seenAt: { 'local:claude:chat': 500 }
    })

    acknowledgeTab(CHAT_PANE_KEY, 1500)

    expect(isLiveSessionUnread(chatSession, marks.getState().seenAt)).toBe(false)
  })

  it('marks a session seen when it is listed after its tab was viewed', () => {
    const { sessions, marks } = startJoin({
      sessions: [],
      seenAt: { 'local:claude:cli': 500 },
      attention: { acknowledgedAgentsByPaneKey: { [CLI_PANE_KEY]: 1500 } }
    })

    sessions.set([cliSession])

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 1000 })
  })

  it('keeps a session unread when its tab was last viewed before it finished', () => {
    const { marks, acknowledgeTab } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 }
    })

    acknowledgeTab(CLI_PANE_KEY, 900)

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 500 })
    expect(isLiveSessionUnread(cliSession, marks.getState().seenAt)).toBe(true)
  })

  it('leaves an external session alone whatever tabs are viewed', () => {
    const external = sampleLiveSession('local:claude:external', {
      status: 'your-turn',
      lastActivityAt: 1000,
      surface: { kind: 'external' }
    })
    const { marks, acknowledged, acknowledgeTab } = startJoin({
      sessions: [external],
      seenAt: { 'local:claude:external': 500 }
    })

    acknowledgeTab(CLI_PANE_KEY, 1500)
    expect(marks.getState().seenAt).toEqual({ 'local:claude:external': 500 })

    marks.markSeen('local:claude:external', 1000)
    expect(acknowledged).toEqual([])
  })

  it('acknowledges the tab once when the session is seen in a session view', () => {
    const { marks, acknowledged } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 },
      attention: { acknowledgedAgentsByPaneKey: { [CLI_PANE_KEY]: 900 } }
    })

    marks.markSeen('local:claude:cli', 1000)

    expect(acknowledged).toEqual([[CLI_PANE_KEY]])
    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 1000 })
  })

  it('acknowledges a completion marker on a tab viewed after the activity', () => {
    const { marks, acknowledged } = startJoin({
      sessions: [chatSession],
      seenAt: { 'local:claude:chat': 1000 },
      attention: {
        acknowledgedAgentsByPaneKey: { [CHAT_PANE_KEY]: 1500 },
        unreadAgentCompletionPanes: { [CHAT_PANE_KEY]: true }
      }
    })

    marks.markSeen('local:claude:chat', 1200)

    expect(acknowledged).toEqual([[CHAT_PANE_KEY]])
  })

  it('does not acknowledge a tab for a session seen only up to older activity', () => {
    const { marks, acknowledged } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 }
    })

    marks.markSeen('local:claude:cli', 800)

    expect(acknowledged).toEqual([])
  })

  it('does not acknowledge a completion marker because an earlier tab view marked the session seen', () => {
    const { marks, acknowledged, acknowledgeTab } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 },
      attention: { unreadAgentCompletionPanes: { [CLI_PANE_KEY]: true } }
    })

    acknowledgeTab(CLI_PANE_KEY, 1500)

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 1000 })
    expect(acknowledged).toEqual([])
  })

  it('does not acknowledge the tab of a session that is only being baselined', () => {
    const { marks, acknowledged } = startJoin({ sessions: [cliSession], seenAt: {} })

    marks.baseline([cliSession])

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 1000 })
    expect(acknowledged).toEqual([])
  })

  it('stops joining once stopped', () => {
    const { marks, acknowledged, acknowledgeTab, stop } = startJoin({
      sessions: [cliSession, chatSession],
      seenAt: { 'local:claude:cli': 500, 'local:claude:chat': 500 }
    })

    stop()
    acknowledgeTab(CLI_PANE_KEY, 1500)
    marks.markSeen('local:claude:chat', 1000)

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 500, 'local:claude:chat': 1000 })
    expect(acknowledged).toEqual([])
  })

  it('keeps the marker and the unread row of an agent that exits by itself', () => {
    const { sessions, marks, acknowledged, raiseCompletionMarker } = startJoin({
      sessions: [{ ...cliSession, status: 'working' }],
      seenAt: { 'local:claude:cli': 500 }
    })
    const exited: LiveSession = { ...cliSession, status: 'done', alive: false }

    sessions.set([exited])
    raiseCompletionMarker(CLI_PANE_KEY)

    expect(acknowledged).toEqual([])
    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 500 })
    expect(isLiveSessionUnread(exited, marks.getState().seenAt)).toBe(true)
  })

  it('keeps the marker and the unread row of an agent that crashes', () => {
    const { sessions, attention, marks, acknowledged, raiseCompletionMarker } = startJoin({
      sessions: [{ ...cliSession, status: 'working' }],
      seenAt: { 'local:claude:cli': 500 }
    })
    const crashed: LiveSession = { ...cliSession, status: 'errored', alive: false }

    sessions.set([crashed])
    raiseCompletionMarker(CLI_PANE_KEY)
    sessions.set([])

    expect(acknowledged).toEqual([])
    expect(attention.get().unreadAgentCompletionPanes).toEqual({ [CLI_PANE_KEY]: true })
    expect(isLiveSessionUnread(crashed, marks.getState().seenAt)).toBe(true)
  })

  it('gives up the marker a pane raises for an agent Seal stopped, and leaves its row unread', () => {
    const { sessions, attention, marks, acknowledged, raiseCompletionMarker } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 }
    })
    const ended: LiveSession = { ...cliSession, status: 'done', alive: false }

    marks.stopped([cliSession])
    sessions.set([ended])
    raiseCompletionMarker(CLI_PANE_KEY)

    expect(acknowledged).toEqual([[CLI_PANE_KEY]])
    expect(attention.get().unreadAgentCompletionPanes).toEqual({})
    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 500 })
    expect(isLiveSessionUnread(ended, marks.getState().seenAt)).toBe(true)
  })

  it('gives up a marker raised before Seal reports the stop', () => {
    const { marks, acknowledged } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 1000 },
      attention: { unreadAgentCompletionPanes: { [CLI_PANE_KEY]: true } }
    })
    expect(acknowledged).toEqual([])

    marks.stopped([cliSession])

    expect(acknowledged).toEqual([[CLI_PANE_KEY]])
  })

  it('marks a stopped session seen once its tab is really viewed', () => {
    const { marks, acknowledgeTab, raiseCompletionMarker } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 500 }
    })
    marks.stopped([cliSession])
    raiseCompletionMarker(CLI_PANE_KEY)

    acknowledgeTab(CLI_PANE_KEY, 3000)

    expect(marks.getState().seenAt).toEqual({ 'local:claude:cli': 1000 })
  })

  it('keeps the marker of a pane where another agent runs after the stopped one', () => {
    const { attention, marks, acknowledged, raiseCompletionMarker } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 1000 }
    })

    marks.stopped([cliSession])
    attention.set({ ...attention.get(), agentStatusByPaneKey: { [CLI_PANE_KEY]: true } })
    raiseCompletionMarker(CLI_PANE_KEY)

    expect(acknowledged).toEqual([])
  })

  it('keeps the marker a pane raises a minute after its agent was stopped', () => {
    let now = 10_000
    const { marks, acknowledged, raiseCompletionMarker } = startJoin({
      sessions: [cliSession],
      seenAt: { 'local:claude:cli': 1000 },
      now: () => now
    })

    marks.stopped([cliSession])
    now += 60_001
    raiseCompletionMarker(CLI_PANE_KEY)

    expect(acknowledged).toEqual([])
  })

  it("keeps a chat tab's completion marker when Seal stops its agent", () => {
    const { sessions, marks, acknowledged } = startJoin({
      sessions: [chatSession],
      seenAt: { 'local:claude:chat': 1000 },
      attention: { unreadAgentCompletionPanes: { [CHAT_PANE_KEY]: true } }
    })

    marks.stopped([chatSession])
    sessions.set([{ ...chatSession, status: 'done', alive: false }])

    expect(acknowledged).toEqual([])
  })
})
