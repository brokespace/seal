import { describe, expect, it } from 'vitest'
import { AGENT_SESSION_AGENT_IDS } from '../../../shared/live-sessions/adapters/agent-session-agent-ids'
import { STRUCTURED_AGENT_RUNTIME_CATALOG } from '../../runtime/agent-session/installation/structured-agent-runtime-metadata'
import { liveSessionAdapter } from './live-session-adapters'

describe('the chat runtime each adapter names', () => {
  it('is the runtime the structured runtime catalog registers for that agent', () => {
    const registered = new Map(
      STRUCTURED_AGENT_RUNTIME_CATALOG.map(({ kind, metadata }) => [
        metadata.definition.agent,
        kind
      ])
    )
    const named = AGENT_SESSION_AGENT_IDS.flatMap((agent) => {
      const runtime = liveSessionAdapter(agent)?.chat?.runtime
      return runtime ? [[agent, runtime] as const] : []
    })
    expect(new Map(named)).toEqual(registered)
  })
})
