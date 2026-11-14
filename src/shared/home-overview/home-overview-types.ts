import type { DashboardRevealAgentArgs } from '../dashboard-snapshot'
import type { ProviderRateLimits } from '../rate-limit-types'

/** Home's session vocabulary; providers map their own lifecycle onto it. */
export type HomeSessionState = 'working' | 'waiting' | 'permission' | 'errored' | 'done' | 'idle'

/** Where clicking a session goes. New registries add their own kinds alongside Orca panes. */
export type HomeSessionTarget =
  | { kind: 'orca-pane'; reveal: DashboardRevealAgentArgs }
  | { kind: 'live-session'; sessionId: string }

export type HomeSession = {
  id: string
  state: HomeSessionState
  /** True until the user has looked at a finished or blocked turn. */
  unseen: boolean
  machineId: string
  machineLabel: string
  projectId: string
  projectName: string
  workspaceName: string
  title: string
  agentType: string
  agentLabel: string
  model?: string
  /** Account the session bills to, when the provider knows it. */
  account?: string
  startedAt: number
  /** When the session entered its current state; 0 means unknown. */
  stateChangedAt: number
  finishedAt: number | null
  lastMessage?: { role: 'agent' | 'user'; text: string }
  /** Short description of what the agent is asking, for waiting/permission sessions. */
  askSummary?: string
  /** What went wrong, for errored sessions. */
  errorSummary?: string
  target: HomeSessionTarget
}

export type HomeMachineKind = 'local' | 'ssh' | 'runtime'
export type HomeMachineStatus = 'online' | 'connecting' | 'offline' | 'error'

export type HomeMachine = {
  id: string
  label: string
  kind: HomeMachineKind
  status: HomeMachineStatus
  /** 1-minute load average divided by core count (1 = fully busy); absent when unknown. */
  load?: number
  memoryUsedPercent?: number
  error?: string
}

export type HomeAccount = {
  id: string
  provider: string
  providerLabel: string
  /** Email or account name; falls back to the provider label. */
  label: string
  /** The account new sessions use for this provider. */
  active: boolean
  /** The rate-limit service's reading: the object the status bar's usage popover shows. */
  limits: ProviderRateLimits | null
  fetching: boolean
  /** The login stopped working; the row asks for a sign-in instead of showing usage. */
  needsSignIn?: boolean
}

export type HomeReviewState = 'open' | 'draft' | 'merged' | 'closed'

export type HomeWorkspace = {
  id: string
  projectName: string
  name: string
  machineId: string
  isFolder: boolean
  review?: { number: number; state: HomeReviewState }
}

export type HomeAutomation = {
  id: string
  name: string
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
}

export type HomeAutomationsResult = {
  automations: HomeAutomation[]
  status: 'loading' | 'ready' | 'error'
}
