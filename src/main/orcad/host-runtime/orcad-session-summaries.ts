import { getAppEnvironment } from '../../../shared/app-environment'
import { getLiveSessionService } from '../../live-sessions/live-session-service-instance'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  installSessionSummaries,
  type SessionSummariesInstallOptions
} from '../../session-summaries/session-summaries-host'

/**
 * A headless server summarizes the agents in its own panes; paired clients read them from its agent
 * rows. It recaps every session in its registry as each stops: a paired desktop on a current build
 * shows this recap instead of making a second one, so nobody else would make it.
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
    onPaneSummaryChanged: () => runtime.notifyAgentStatusSummaryChanged()
  })
  registerCleanup(() => summaries.dispose())
}
