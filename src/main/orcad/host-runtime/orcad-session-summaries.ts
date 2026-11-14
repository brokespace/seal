import { getAppEnvironment } from '../../../shared/app-environment'
import { getLiveSessionService } from '../../live-sessions/live-session-service-instance'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  installSessionSummaries,
  type SessionSummariesInstallOptions
} from '../../session-summaries/session-summaries-host'

/**
 * A headless server summarizes the agents in its own panes; paired clients read them from its agent
 * rows. Its registry sessions get a recap only once a client paired to it opens one: a desktop that
 * sees the same sessions already recaps them, and the allocation is one account's.
 */
export function startOrcadSessionSummaries(
  runtime: OrcaRuntimeService,
  store: SessionSummariesInstallOptions['store'],
  registerCleanup: (cleanup: () => void) => void
): void {
  const summaries = installSessionSummaries({
    runtime,
    store,
    userDataPath: getAppEnvironment().getPath('userData'),
    liveSessions: getLiveSessionService(),
    summarizeLive: false,
    recapEagerly: false,
    onPaneSummaryChanged: () => runtime.notifyAgentStatusSummaryChanged()
  })
  registerCleanup(() => summaries.dispose())
}
