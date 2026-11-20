import type { LiveSessionMachineIdentity } from '../live-sessions/live-session-machine-id'
import type { ProviderRateLimits } from '../rate-limit-types'

export type HomeMachineKind = 'local' | 'ssh' | 'runtime'
export type HomeMachineStatus = 'online' | 'connecting' | 'offline' | 'error'

export type HomeMachine = LiveSessionMachineIdentity & {
  label: string
  kind: HomeMachineKind
  status: HomeMachineStatus
  /** 1-minute load average divided by core count (1 = fully busy); absent when unknown. */
  load?: number
  memoryUsedPercent?: number
  /** Mean utilization across the machine's GPUs; absent on a machine with none. */
  gpuUtilizationPercent?: number
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
  /** Why it needs one: its session ran out, or it holds no login. */
  signInReason?: 'expired' | 'signed-out'
  /** The vault account to sign in again; absent for rows that are not vault accounts. */
  accountKey?: string
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
