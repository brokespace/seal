import type { AgentPaneChange } from '../agent-hooks/observations/agent-transition-detector'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { SessionSummarySettings } from '../../shared/session-summaries/session-summary-contracts'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import type { UtilityModelClient } from '../utility-model/utility-model-host'
import type { UtilityModelHostContext } from '../utility-model/utility-model-provider-sources'
import type { CliTabTitleRuntime } from './cli-session-tab-title'
import type { LiveSessionSummariesDeps } from './live-session-summaries'

type SummarySettingsStore = {
  getSettings(): SessionSummarySettings & ReturnType<UtilityModelHostContext['settings']>
  updateSettings(updates: SessionSummarySettings): unknown
  onSettingsChanged(listener: (updates: Partial<SessionSummarySettings>) => void): unknown
}

type SummaryRuntime = Pick<CliTabTitleRuntime, 'setMobileSessionTabProps'> & {
  agentTransitions: {
    subscribe(listener: (change: AgentPaneChange) => void): () => void
    latestRow(paneKey: string): AgentStatusIpcPayload | null
    trackedPaneSeeds(): AgentPaneChange[]
  }
  /** The accounts agent CLIs run on; without it only providers with a saved key can be used. */
  getCommitMessageAgentEnvironmentResolvers?: UtilityModelHostContext['agentEnvironment']
}

export type SessionSummariesInstallOptions = {
  runtime: SummaryRuntime
  store: SummarySettingsStore
  userDataPath: string
  /** This host's session registry: its sessions get recaps, and status summaries unless `summarizeLive` is off. */
  liveSessions?: LiveSessionService | null
  /** False on a headless server, whose registry sessions the desktop that sees them summarizes. */
  summarizeLive?: boolean
  /** Recap every stopped session (the desktop), or only those opened from a client of this host. */
  recapEagerly?: boolean
  serverSummaries?: LiveSessionSummariesDeps['serverSummaries']
  /** A pane's summary changed: clients reading agent rows should read again. */
  onPaneSummaryChanged?: () => void
  /** One model for both summaries and recaps, in place of the providers Settings chose. */
  utilityModel?: UtilityModelClient
}
