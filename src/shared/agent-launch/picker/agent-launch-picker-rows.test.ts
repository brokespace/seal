import { describe, expect, it } from 'vitest'
import { buildNewTabAgentMenuRows, type HostChatAnswer } from './agent-launch-picker-rows'
import { agentPickerEntriesFromRows } from './agent-launch-picker'
import type { TuiAgent } from '../catalog/tui-agent'

function rows(input: {
  surface: 'chat' | 'terminal'
  installed: TuiAgent[]
  answer?: HostChatAnswer
  program?: 'available' | 'missing'
}) {
  return buildNewTabAgentMenuRows({
    settings: { agentDefaultSurface: input.surface, defaultTuiAgent: 'claude' },
    detectedOnHost: input.installed,
    chatAgents: ['claude', 'codex'],
    hostChatAnswer: () => input.answer ?? 'yes',
    chatProgram: () => input.program ?? 'available'
  })
}

const entries = (built: ReturnType<typeof rows>, installed: TuiAgent[] | null) =>
  agentPickerEntriesFromRows(
    built,
    installed,
    () => ({ terminal: {}, structured: {} }),
    (agent) => agent,
    'claude'
  ).map(({ agent, surfaces, defaultSurface, terminalMissing, chatAction }) => ({
    agent,
    surfaces,
    defaultSurface,
    ...(terminalMissing ? { terminalMissing } : {}),
    ...(chatAction ? { chatAction } : {})
  }))

describe('buildNewTabAgentMenuRows', () => {
  it('keeps the CLI row of an agent whose chat is the default', () => {
    const built = rows({ surface: 'chat', installed: ['claude', 'codex', 'gemini'] })
    expect(built).toEqual([
      { kind: 'chat', agent: 'claude' },
      { kind: 'chat', agent: 'codex' },
      { kind: 'cli', agent: 'claude' },
      { kind: 'cli', agent: 'codex' },
      { kind: 'cli', agent: 'gemini' }
    ])
    expect(entries(built, ['claude', 'codex', 'gemini'])).toEqual([
      { agent: 'claude', surfaces: ['chat', 'terminal'], defaultSurface: 'chat' },
      { agent: 'codex', surfaces: ['chat', 'terminal'], defaultSurface: 'chat' },
      { agent: 'gemini', surfaces: ['terminal'], defaultSurface: 'terminal' }
    ])
  })

  it('offers the chat beside a CLI that is the default', () => {
    const built = rows({ surface: 'terminal', installed: ['claude', 'codex', 'gemini'] })
    expect(built).toEqual([
      { kind: 'cli', agent: 'claude', chat: true },
      { kind: 'cli', agent: 'codex', chat: true },
      { kind: 'cli', agent: 'gemini' }
    ])
    expect(entries(built, ['claude', 'codex', 'gemini'])).toEqual([
      { agent: 'claude', surfaces: ['chat', 'terminal'], defaultSurface: 'terminal' },
      { agent: 'codex', surfaces: ['chat', 'terminal'], defaultSurface: 'terminal' },
      { agent: 'gemini', surfaces: ['terminal'], defaultSurface: 'terminal' }
    ])
  })

  it('marks the CLI of an agent the host lacks as missing instead of dropping it', () => {
    const built = rows({ surface: 'chat', installed: ['claude'] })
    expect(built).toEqual([
      { kind: 'chat', agent: 'claude' },
      { kind: 'chat', agent: 'codex' },
      { kind: 'cli', agent: 'claude' }
    ])
    expect(entries(built, ['claude'])).toEqual([
      { agent: 'claude', surfaces: ['chat', 'terminal'], defaultSurface: 'chat' },
      { agent: 'codex', surfaces: ['chat'], defaultSurface: 'chat', terminalMissing: true }
    ])
    // An unknown inventory offers the CLI; the launch reports a missing binary.
    expect(entries(built, null)[1]).toEqual({
      agent: 'codex',
      surfaces: ['chat', 'terminal'],
      defaultSurface: 'chat'
    })
  })

  it('lists plain terminal rows on a host that runs no chats', () => {
    expect(rows({ surface: 'chat', installed: ['claude', 'gemini'], answer: 'no-chats' })).toEqual([
      { kind: 'terminal', agent: 'claude' },
      { kind: 'terminal', agent: 'gemini' }
    ])
  })

  it('offers the server install on an SSH machine without one, for either default', () => {
    const chatDefault = rows({ surface: 'chat', installed: ['claude'], answer: 'needs-server' })
    expect(chatDefault).toEqual([
      { kind: 'chat-unavailable', agent: 'claude', reason: 'needs-server' },
      { kind: 'chat-unavailable', agent: 'codex', reason: 'needs-server' },
      { kind: 'cli', agent: 'claude' }
    ])
    expect(entries(chatDefault, ['claude'])).toEqual([
      {
        agent: 'claude',
        surfaces: ['terminal'],
        defaultSurface: 'terminal',
        chatAction: 'install-server'
      },
      {
        agent: 'codex',
        surfaces: [],
        defaultSurface: 'terminal',
        terminalMissing: true,
        chatAction: 'install-server'
      }
    ])
    const cliDefault = rows({ surface: 'terminal', installed: ['claude'], answer: 'needs-server' })
    expect(cliDefault).toEqual([{ kind: 'cli', agent: 'claude', needsServer: true }])
    expect(entries(cliDefault, ['claude'])[0]?.chatAction).toBe('install-server')
  })

  it('opens the CLI in chat view where the host runs no structured chat', () => {
    expect(rows({ surface: 'chat', installed: ['claude'], answer: 'via-cli' })).toEqual([
      { kind: 'chat', agent: 'claude', viaCli: true },
      { kind: 'chat-unavailable', agent: 'codex', reason: 'not-installed' },
      { kind: 'cli', agent: 'claude' }
    ])
    expect(rows({ surface: 'terminal', installed: ['claude'], answer: 'via-cli' })).toEqual([
      { kind: 'cli', agent: 'claude', chat: true, viaCli: true }
    ])
  })
})
