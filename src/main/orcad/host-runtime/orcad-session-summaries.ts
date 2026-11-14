import { getAppEnvironment } from '../../../shared/app-environment'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  installSessionSummaries,
  type SessionSummariesInstallOptions
} from '../../session-summaries/session-summaries-host'

/** A headless server summarizes the agents in its own panes; paired clients read them from its agent rows. */
export function startOrcadSessionSummaries(
  runtime: OrcaRuntimeService,
  store: SessionSummariesInstallOptions['store'],
  registerCleanup: (cleanup: () => void) => void
): void {
  const summaries = installSessionSummaries({
    runtime,
    store,
    userDataPath: getAppEnvironment().getPath('userData'),
    onPaneSummaryChanged: () => runtime.notifyAgentStatusSummaryChanged()
  })
  registerCleanup(() => summaries.dispose())
}
