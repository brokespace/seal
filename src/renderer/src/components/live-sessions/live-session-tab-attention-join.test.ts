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
}) {
  const sessions = observable<readonly LiveSession[]>(options.sessions)
  const attention = observable<TabAttention>({
    acknowledgedAgentsByPaneKey: {},
    unreadAgentCompletionPanes: {},
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
    marks
  })
  const acknowledgeTab = (paneKey: string, at: number): void =>
    attention.set({
      ...attention.get(),
      acknowledgedAgentsByPaneKey: { ...attention.get().acknowledgedAgentsByPaneKey, [paneKey]: at }
    })
  return { sessions, marks, acknowledged, acknowledgeTab, stop }
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
})
