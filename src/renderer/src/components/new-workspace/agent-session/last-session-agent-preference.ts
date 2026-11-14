import { isTuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'

const STORAGE_KEY = 'seal.new-agent-session.agent.v1'
const BLANK_TERMINAL = 'blank'

/** The agent last started from the New agent session dialog: null is a blank terminal, undefined is no choice yet. */
export function loadLastSessionAgent(): TuiAgent | null | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === BLANK_TERMINAL) {
      return null
    }
    return isTuiAgent(stored) ? stored : undefined
  } catch {
    return undefined
  }
}

export function saveLastSessionAgent(agent: TuiAgent | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, agent ?? BLANK_TERMINAL)
  } catch {
    // The dialog falls back to the default agent when device storage is full.
  }
}

/** A reopened create keeps its pick; New agent session starts from the agent it launched last. */
export function initialComposerAgent(modalData: {
  recovery?: { agent: TuiAgent | null }
  agentSession?: true
}): TuiAgent | null | undefined {
  if (modalData.recovery) {
    return modalData.recovery.agent
  }
  return modalData.agentSession ? loadLastSessionAgent() : undefined
}
