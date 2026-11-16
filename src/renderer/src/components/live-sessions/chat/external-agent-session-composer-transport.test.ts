import { describe, expect, it } from 'vitest'
import type { AgentSessionCapabilityFlags } from '../../../../../shared/live-sessions/live-session-types'
import {
  externalAgentSessionComposerTransport,
  type ExternalAgentSessionComposerInput
} from './external-agent-session-composer-transport'

const WRITABLE: AgentSessionCapabilityFlags = {
  send: true,
  answer: 'options',
  transcript: true,
  recap: true,
  context: 'estimated',
  switchSurface: { toChat: false, toCli: false },
  takeOver: true
}

function transportFor(overrides: Partial<ExternalAgentSessionComposerInput> = {}): {
  transport: ReturnType<typeof externalAgentSessionComposerTransport>
  sent: string[]
} {
  const sent: string[] = []
  const transport = externalAgentSessionComposerTransport({
    sessionId: 'local:claude:s1',
    capabilities: WRITABLE,
    worktreeId: 'wt-1',
    runtimeEnvironmentId: null,
    attachmentsUnavailableNotice: 'no files here',
    sendUnavailableReason: 'no route',
    context: {
      usedTokens: 50_000,
      windowTokens: 200_000,
      percentage: 25,
      estimated: true,
      rows: []
    },
    send: (text) => sent.push(text),
    onError: () => {},
    ...overrides
  })
  return { transport, sent }
}

describe('externalAgentSessionComposerTransport', () => {
  it('sends a message, with each attached file as a path reference, as one plain text', async () => {
    const { transport, sent } = transportFor()

    expect(await transport.send('look at this', [])).toBe(true)
    expect(await transport.send('and this', [{ id: 'a', path: '/tmp/shot one.png' }])).toBe(true)

    expect(sent).toEqual(['look at this', 'and this\n@"/tmp/shot one.png"'])
    expect(transport.sendBlockedReason).toBeUndefined()
  })

  it('sends nothing and says why when the session has no input route', async () => {
    const { transport, sent } = transportFor({ capabilities: { ...WRITABLE, send: false } })

    expect(await transport.send('hello', [])).toBe(false)

    expect(sent).toEqual([])
    expect(transport.sendBlockedReason).toBe('no route')
  })

  it('shows the context ring only for a session that reports its context', () => {
    expect(transportFor().transport.contextUsage).toEqual({
      usedTokens: 50_000,
      windowTokens: 200_000,
      percentage: 25,
      estimated: true,
      categories: []
    })
    expect(
      transportFor({ capabilities: { ...WRITABLE, context: 'none' } }).transport.contextUsage
    ).toBeNull()
  })

  it('leaves slash commands to the session’s own agent', async () => {
    const { transport } = transportFor()

    expect(await transport.dispatchCommand('/model')).toEqual({
      handled: false,
      accepted: false,
      error: null
    })
  })
})
