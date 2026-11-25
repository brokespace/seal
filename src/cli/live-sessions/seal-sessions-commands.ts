import { getOptionalStringFlag } from '../arguments/flags'
import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import type { LiveSessionRegistrySnapshot } from '../../shared/live-sessions/live-session-types'
import { filterLiveSessionSnapshot, formatLiveSessions } from './seal-sessions-format'

export const SEAL_SESSIONS_HANDLERS: Record<string, CommandHandler> = {
  'sessions list': async (ctx) => {
    const response = await ctx.client.call<LiveSessionRegistrySnapshot>('liveSessions.list', {})
    const snapshot = filterLiveSessionSnapshot(response.result, {
      machine: getOptionalStringFlag(ctx.flags, 'machine'),
      project: getOptionalStringFlag(ctx.flags, 'project')
    })
    printResult({ ...response, result: snapshot }, ctx.json, (listed) =>
      formatLiveSessions(listed, ctx.flags.get('all') === true)
    )
  }
}
