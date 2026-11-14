import { SessionSummariesSetEnabledParams } from '../../../../../shared/rpc-contract/session-summaries-params'
import { SESSION_SUMMARIES_LIST_METHOD } from '../../../../../shared/session-summaries/session-summary-contracts'
import { requireSessionSummariesHost } from '../../../../session-summaries/session-summaries-instance'
import { defineMethod } from '../../core'

/** Session status summaries made on this host, for clients and for a desktop that shows this server's sessions. */
export const SESSION_SUMMARY_METHODS = [
  defineMethod({
    name: 'sessionSummaries.status',
    permission: 'workspace',
    params: null,
    handler: async () => requireSessionSummariesHost().status()
  }),
  defineMethod({
    name: SESSION_SUMMARIES_LIST_METHOD,
    permission: 'workspace',
    params: null,
    handler: async () => requireSessionSummariesHost().list()
  }),
  defineMethod({
    name: 'sessionSummaries.setEnabled',
    permission: 'settings-write',
    params: SessionSummariesSetEnabledParams,
    handler: async ({ enabled }) => requireSessionSummariesHost().setEnabled(enabled)
  })
] as const
