import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import type { NewTabAgentMenuRow } from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type { NewTabAgentMenuModel } from '../tab-bar/new-tab-agent-menu-model'
import { TabAgentSurfaceRows } from '../tab-bar/TabAgentSurfaceRows'
import { AgentLaunchPickerMenu } from './AgentLaunchPickerMenu'

const entry = (
  agent: AgentPickerEntry['agent'],
  label: string,
  fields: Pick<AgentPickerEntry, 'rows' | 'surfaces' | 'defaultSurface'> &
    Partial<Pick<AgentPickerEntry, 'terminalMissing' | 'chatAction'>>
): AgentPickerEntry => ({
  agent,
  label,
  terminal: {},
  structured: {},
  catalog: { origin: 'unknown' },
  ...fields
})

const LOCAL: AgentPickerEntry[] = [
  entry('claude', 'Claude', {
    rows: [
      { kind: 'chat', agent: 'claude' },
      { kind: 'cli', agent: 'claude' }
    ],
    surfaces: ['chat', 'terminal'],
    defaultSurface: 'chat'
  }),
  entry('codex', 'Codex', {
    rows: [{ kind: 'cli', agent: 'codex', chat: true }],
    surfaces: ['chat', 'terminal'],
    defaultSurface: 'terminal'
  }),
  entry('gemini', 'Gemini', {
    rows: [{ kind: 'cli', agent: 'gemini' }],
    surfaces: ['terminal'],
    defaultSurface: 'terminal'
  }),
  entry('copilot', 'GitHub Copilot', {
    rows: [
      { kind: 'chat', agent: 'copilot' },
      { kind: 'cli', agent: 'copilot' }
    ],
    surfaces: ['chat', 'terminal'],
    defaultSurface: 'chat'
  }),
  entry('antigravity', 'Antigravity', {
    rows: [{ kind: 'cli', agent: 'antigravity', noChat: 'windows' }],
    surfaces: ['terminal'],
    defaultSurface: 'terminal'
  }),
  entry('opencode', 'OpenCode', {
    rows: [{ kind: 'chat', agent: 'opencode' }],
    surfaces: ['chat'],
    defaultSurface: 'chat',
    terminalMissing: true
  })
]

const SSH_HOST = 'ssh:kessel-ml'
const SSH: AgentPickerEntry[] = [
  entry('claude', 'Claude', {
    rows: [
      {
        kind: 'chat-unavailable',
        agent: 'claude',
        reason: 'needs-server',
        executionHostId: SSH_HOST
      }
    ],
    surfaces: [],
    defaultSurface: 'terminal',
    terminalMissing: 'needs-server',
    chatAction: 'install-server'
  }),
  entry('codex', 'Codex', {
    rows: [{ kind: 'chat', agent: 'codex', executionHostId: SSH_HOST }],
    surfaces: ['chat'],
    defaultSurface: 'chat',
    terminalMissing: true
  }),
  entry('gemini', 'Gemini', {
    rows: [
      { kind: 'chat-unavailable', agent: 'gemini', reason: 'windows', executionHostId: SSH_HOST },
      { kind: 'cli', agent: 'gemini', executionHostId: SSH_HOST }
    ],
    surfaces: ['terminal'],
    defaultSurface: 'terminal'
  })
]

function settled(entries: AgentPickerEntry[], terminalPending = false): NewTabAgentMenuModel {
  const detectedIds = entries.flatMap((item) => (item.terminalMissing ? [] : [item.agent]))
  return {
    state: 'settled',
    rows: entries.flatMap((item) => item.rows),
    terminalPending,
    detection: {
      detectedIds,
      isLoading: false,
      detectionFailed: false,
      isRefreshing: false,
      needsServerUpdate: false,
      refresh: async () => detectedIds
    }
  }
}

function pickerFixture(entries: AgentPickerEntry[], terminalPending = false) {
  return defineFixture({
    width: 416,
    render: () => (
      <div className="h-[340px] bg-background p-3">
        <DropdownMenu defaultOpen modal={false}>
          <DropdownMenuTrigger>New tab</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-96">
            <AgentLaunchPickerMenu
              entries={entries}
              model={settled(entries, terminalPending)}
              shortcutLabels={
                new Map([
                  ['claude', 'Ctrl+Shift+A'],
                  ['codex', 'Ctrl+Shift+X'],
                  ['copilot', 'Ctrl+Alt+Shift+U']
                ])
              }
              hideSearch
              runLaunch={() => false}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  })
}

export const bothSurfaces = pickerFixture(LOCAL)
export const sshMachineWithoutServer = pickerFixture(SSH)
export const hostConnecting = pickerFixture(LOCAL, true)

const FLAT_ROWS: NewTabAgentMenuRow[] = [
  { kind: 'chat', agent: 'claude' },
  { kind: 'chat', agent: 'opencode' },
  { kind: 'chat-unavailable', agent: 'pi', reason: 'needs-server', executionHostId: SSH_HOST },
  { kind: 'chat-unavailable', agent: 'copilot', reason: 'windows' },
  { kind: 'cli', agent: 'claude' },
  { kind: 'cli', agent: 'codex', chat: true },
  { kind: 'cli', agent: 'gemini' }
]

export const flatList = defineFixture({
  width: 300,
  render: () => (
    <div className="h-[330px] bg-background p-3">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>Agents</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <TabAgentSurfaceRows
            rows={FLAT_ROWS}
            detectedIds={['claude', 'codex', 'gemini']}
            disabled={false}
            defaultAgent="claude"
            runLaunch={() => false}
          />
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
