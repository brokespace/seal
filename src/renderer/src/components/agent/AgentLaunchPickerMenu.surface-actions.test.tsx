// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentLaunchPickerMenu } from './AgentLaunchPickerMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
vi.mock('@/hooks/useShortcutLabel', () => ({ useOptionalShortcutLabel: () => null }))
afterEach(cleanup)

it('launches exactly the surface a row action names, by pointer and from the keyboard', () => {
  const entry: AgentPickerEntry = {
    agent: 'claude',
    label: 'Claude',
    defaultSurface: 'chat',
    surfaces: ['chat', 'terminal'],
    terminal: {},
    structured: {},
    catalog: { origin: 'probe', fetchedAt: 1, models: [] },
    rows: [
      { kind: 'chat', agent: 'claude' },
      { kind: 'cli', agent: 'claude' }
    ]
  }
  // A refused launch keeps the menu open for the next action.
  const launch = vi.fn(() => false)
  render(
    <TooltipProvider>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>New tab</DropdownMenuTrigger>
        <DropdownMenuContent>
          <AgentLaunchPickerMenu entries={[entry]} runLaunch={launch} hideSearch />
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
  const row = screen.getByRole('menuitem', { name: 'Claude' })
  const action = (surface: string) =>
    row.querySelector<HTMLElement>(`[data-agent-surface-action="${surface}"]`)!
  fireEvent.click(action('terminal'))
  expect(launch.mock.calls).toEqual([[{ kind: 'cli', agent: 'claude' }]])
  // Tab walks the row's actions, default surface first; Enter starts the focused one, not the row's default.
  act(() => row.focus())
  fireEvent.keyDown(row, { key: 'Tab' })
  expect(document.activeElement).toBe(action('chat'))
  fireEvent.keyDown(action('chat'), { key: 'Tab' })
  expect(document.activeElement).toBe(action('terminal'))
  fireEvent.keyDown(action('terminal'), { key: 'Enter' })
  expect(launch.mock.calls).toEqual([
    [{ kind: 'cli', agent: 'claude' }],
    [{ kind: 'cli', agent: 'claude' }]
  ])
})
