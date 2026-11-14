import {
  SessionRecapGetParams,
  SessionRecapMarkParams,
  SessionRecapRefreshParams,
  SessionRecapSetEnabledParams
} from '../../../../../shared/rpc-contract/session-recap-params'
import type { LiveSessionRecaps } from '../../../../session-recap/live-session-recaps'
import { requireSessionSummariesHost } from '../../../../session-summaries/session-summaries-instance'
import { defineMethod } from '../../core'

function recaps(): LiveSessionRecaps {
  const found = requireSessionSummariesHost().recaps
  if (!found) {
    throw new Error('Session recaps are not available on this host')
  }
  return found
}

/** A session's recap on the host that owns its registry, for the desktop window and phones alike. */
export const SESSION_RECAP_METHODS = [
  defineMethod({
    name: 'sessionRecap.get',
    permission: 'workspace',
    params: SessionRecapGetParams,
    handler: async ({ sessionId, look }) => recaps().view(sessionId, look === true)
  }),
  defineMethod({
    name: 'sessionRecap.refresh',
    permission: 'workspace',
    params: SessionRecapRefreshParams,
    handler: ({ sessionId }) => recaps().refresh(sessionId)
  }),
  defineMethod({
    name: 'sessionRecap.mark',
    permission: 'workspace',
    params: SessionRecapMarkParams,
    handler: async ({ sessionId, itemId, mark }) => recaps().mark(sessionId, itemId, mark)
  }),
  defineMethod({
    name: 'sessionRecap.setEnabled',
    permission: 'settings-write',
    params: SessionRecapSetEnabledParams,
    handler: async ({ enabled }) => requireSessionSummariesHost().setRecapEnabled(enabled)
  })
] as const
