import { app } from 'electron'
import { parseExecutionHostId } from '../../shared/execution-host'
import {
  SESSION_SUMMARIES_LIST_METHOD,
  type SessionSummariesListResult
} from '../../shared/session-summaries/session-summary-contracts'
import { runtimeEnvironmentCall } from '../live-sessions/hosts/connected-runtime-hosts'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  installSessionSummaries,
  type SessionSummariesHost,
  type SessionSummariesInstallOptions
} from './session-summaries-host'

const SERVER_LIST_TIMEOUT_MS = 15_000

function isListResult(value: unknown): value is SessionSummariesListResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'object' &&
    value.status !== null &&
    'sessions' in value &&
    Array.isArray(value.sessions)
  )
}

/** The desktop summarizes its own panes and every registry session no paired server already summarizes. */
export function installDesktopSessionSummaries(
  runtime: OrcaRuntimeService,
  store: SessionSummariesInstallOptions['store'],
  liveSessions: LiveSessionService
): SessionSummariesHost {
  const userDataPath = app.getPath('userData')
  const call = runtimeEnvironmentCall(userDataPath)
  return installSessionSummaries({
    runtime,
    store,
    userDataPath,
    liveSessions,
    serverSummaries: async (executionHostId) => {
      const host = parseExecutionHostId(executionHostId)
      if (host?.kind !== 'runtime') {
        return null
      }
      const response = await call(
        host.environmentId,
        SESSION_SUMMARIES_LIST_METHOD,
        undefined,
        SERVER_LIST_TIMEOUT_MS
      )
      // A server from before summaries answers method_not_found: its sessions are summarized here.
      return response.ok === true && isListResult(response.result) ? response.result : null
    },
    onPaneSummaryChanged: () => runtime.notifyAgentStatusSummaryChanged()
  })
}
