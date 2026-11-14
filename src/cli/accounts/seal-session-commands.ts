import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/types'
import { getRequiredStringFlag } from '../arguments/flags'
import type {
  SealAccountsStatus,
  SealSessionLiveSwapMode,
  SealSessionSwapEntry
} from '../../shared/seal-accounts/seal-accounts-status'
import { formatSwapEntry } from './seal-account-format'

const LIVE_MODES: readonly SealSessionLiveSwapMode[] = ['inherit', 'on', 'off']

/** Accepts a full session id or a unique prefix of one, as `seal account sessions` shows it. */
async function sessionId(ctx: HandlerContext): Promise<string> {
  const ref = getRequiredStringFlag(ctx.flags, 'session')
  const { result } = await ctx.client.call<SealAccountsStatus>('seal.accounts.status', {})
  const matches = result.sessions.filter((session) => session.id.startsWith(ref))
  if (matches.length !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      matches.length === 0 ? `No session matches "${ref}".` : `"${ref}" matches several sessions.`
    )
  }
  return matches[0].id
}

export const SEAL_SESSION_HANDLERS: Record<string, CommandHandler> = {
  'account session swap': async (ctx) => {
    const response = await ctx.client.call<{ entry: SealSessionSwapEntry }>(
      'seal.accounts.swapSession',
      { sessionId: await sessionId(ctx), account: getRequiredStringFlag(ctx.flags, 'account') }
    )
    printResult(response, ctx.json, ({ entry }) => formatSwapEntry(entry))
  },
  'account session live': async (ctx) => {
    const value = getRequiredStringFlag(ctx.flags, 'mode')
    const mode = LIVE_MODES.find((entry) => entry === value)
    if (!mode) {
      throw new RuntimeClientError('invalid_argument', '--mode must be inherit, on or off')
    }
    const id = await sessionId(ctx)
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.setSessionLiveSwap', {
      sessionId: id,
      mode
    })
    printResult(response, ctx.json, () => `Live swap for ${id.slice(0, 8)}: ${mode}`)
  }
}
