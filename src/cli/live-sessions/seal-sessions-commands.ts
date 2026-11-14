import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import type { LiveSessionRegistrySnapshot } from '../../shared/live-sessions/live-session-types'
import { formatLiveSessions } from './seal-sessions-format'

export const SEAL_SESSIONS_HANDLERS: Record<string, CommandHandler> = {
  'sessions list': async (ctx) => {
    const response = await ctx.client.call<LiveSessionRegistrySnapshot>('liveSessions.list', {})
    printResult(response, ctx.json, (snapshot) =>
      formatLiveSessions(snapshot, ctx.flags.get('all') === true)
    )
  }
}
