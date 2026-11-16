import type { KeybindingActionId, KeybindingDefinition } from './types'
import { platformBindings } from './definitions-support'

/** Reach the app from any focus: main intercepts them ahead of editors and embedded pages. */
export const SPLIT_VIEW_ACTION_IDS = [
  'splitView.focusNextPane',
  'splitView.focusPreviousPane',
  'splitView.toggleMaximize',
  'splitView.moveTabRight',
  'splitView.moveTabDown',
  'splitView.closePane'
] as const satisfies readonly KeybindingActionId[]

export type SplitViewActionId = (typeof SPLIT_VIEW_ACTION_IDS)[number]

// Titles say "Split view" because "Focus next pane" already names the terminal panes inside one tab.
export const KEYBINDING_DEFINITION_SPLIT_VIEW: readonly KeybindingDefinition[] = [
  {
    id: 'splitView.focusNextPane',
    title: 'Split view: focus next pane',
    group: 'Split view',
    scope: 'global',
    searchKeywords: ['shortcut', 'split view', 'pane', 'focus', 'next'],
    defaultBindings: platformBindings(['Mod+Alt+ArrowDown']),
    allowInTerminal: true
  },
  {
    id: 'splitView.focusPreviousPane',
    title: 'Split view: focus previous pane',
    group: 'Split view',
    scope: 'global',
    searchKeywords: ['shortcut', 'split view', 'pane', 'focus', 'previous'],
    defaultBindings: platformBindings(['Mod+Alt+ArrowUp']),
    allowInTerminal: true
  },
  {
    id: 'splitView.toggleMaximize',
    title: 'Split view: maximize / restore',
    group: 'Split view',
    scope: 'global',
    searchKeywords: ['shortcut', 'split view', 'pane', 'maximize', 'restore', 'expand'],
    defaultBindings: platformBindings(['Mod+Alt+Enter']),
    allowInTerminal: true
  },
  {
    id: 'splitView.moveTabRight',
    title: 'Split view: move tab to a pane on the right',
    group: 'Split view',
    scope: 'global',
    searchKeywords: ['shortcut', 'split view', 'pane', 'tab', 'move', 'split', 'right'],
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  },
  {
    id: 'splitView.moveTabDown',
    title: 'Split view: move tab to a pane below',
    group: 'Split view',
    scope: 'global',
    searchKeywords: ['shortcut', 'split view', 'pane', 'tab', 'move', 'split', 'down', 'below'],
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  },
  {
    id: 'splitView.closePane',
    title: 'Split view: close pane',
    group: 'Split view',
    scope: 'global',
    searchKeywords: ['shortcut', 'split view', 'pane', 'close'],
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  }
]
