import type { BrowserFocusTarget } from '../components/browser-pane/host-guest/browser-focus'
import type { WorkspaceVisibleTabType } from '../../../shared/tab-types'

/** Capture focus before Radix mounts the modal; document.activeElement no longer identifies the return surface at close. */
export type ModalReturnFocusSurface = {
  tabType: WorkspaceVisibleTabType
  worktreeId: string | null
  browserPageId: string | null
  browserTarget: BrowserFocusTarget
  terminalTabId: string | null
  terminalLeafId: string | null
}

export type ModalReturnFocusAction =
  | { kind: 'browser'; pageId: string; target: BrowserFocusTarget }
  | { kind: 'terminal'; tabId: string; leafId: string | null }
  | { kind: 'editor' }
  | { kind: 'simulator' }
  | { kind: 'surface' }
  | { kind: 'none' }

// Monaco with EditContext types into this element; its textarea is only an IME helper.
const MONACO_INPUT_SELECTOR = '.monaco-editor .native-edit-context'

/** Where keyboard input goes in each kind of workspace content, first match wins. */
export const WORKSPACE_FOCUS_SELECTORS = {
  editor: [
    MONACO_INPUT_SELECTOR,
    '.monaco-editor textarea',
    '.rich-markdown-editor[contenteditable="true"]',
    '.markdown-preview'
  ],
  simulator: ['[data-orca-emulator-frame="true"] [tabindex]'],
  surface: ['.xterm-helper-textarea', MONACO_INPUT_SELECTOR, '.monaco-editor textarea']
} as const satisfies Record<string, readonly string[]>

// Route webContents focus through browser requests; use surface-specific DOM focus elsewhere so hidden xterm cannot steal it.
export function resolveModalReturnFocusAction(
  captured: ModalReturnFocusSurface | null
): ModalReturnFocusAction {
  if (!captured) {
    return { kind: 'none' }
  }
  if (captured.tabType === 'browser' && captured.browserPageId) {
    return { kind: 'browser', pageId: captured.browserPageId, target: captured.browserTarget }
  }
  if (captured.tabType === 'terminal' && captured.terminalTabId) {
    return { kind: 'terminal', tabId: captured.terminalTabId, leafId: captured.terminalLeafId }
  }
  if (captured.tabType === 'editor' && captured.worktreeId) {
    return { kind: 'editor' }
  }
  if (captured.tabType === 'simulator' && captured.worktreeId) {
    return { kind: 'simulator' }
  }
  if (captured.worktreeId) {
    return { kind: 'surface' }
  }
  return { kind: 'none' }
}
