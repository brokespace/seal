import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/types'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import { SEAL_PROVIDERS, type SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type {
  SealAccountsStatus,
  SealSystemLogin
} from '../../shared/seal-accounts/seal-accounts-status'
import { formatSealAccountsTable } from './seal-account-table'

type RemoveResult = {
  result: {
    removed: string
    label: string
    loggedOut: boolean
    logoutError: string | null
    nowUsing: string | null
  }
  status: SealAccountsStatus
}

function optionalProvider(ctx: HandlerContext): SealProvider | undefined {
  const value = getOptionalStringFlag(ctx.flags, 'agent')
  if (value === undefined) {
    return undefined
  }
  const match = SEAL_PROVIDERS.find((entry) => entry === value)
  if (!match) {
    throw new RuntimeClientError('invalid_argument', '--agent must be claude or codex')
  }
  return match
}

function requiredProvider(ctx: HandlerContext): SealProvider {
  const match = optionalProvider(ctx)
  if (!match) {
    throw new RuntimeClientError('invalid_argument', 'Missing --agent (claude or codex)')
  }
  return match
}

function table(status: SealAccountsStatus, providers: readonly SealProvider[]): string {
  return formatSealAccountsTable(status, providers, Date.now())
}

export const SEAL_ACCOUNT_ROSTER_HANDLERS: Record<string, CommandHandler> = {
  'account remove': async (ctx) => {
    const logout = ctx.flags.get('logout') === true
    const response = await ctx.client.call<RemoveResult>('seal.accounts.removeAccount', {
      account: getRequiredStringFlag(ctx.flags, 'account'),
      provider: optionalProvider(ctx),
      logout
    })
    printResult(response, ctx.json, ({ result }) =>
      [
        `Removed ${result.label} (${result.removed}) from Seal.`,
        result.loggedOut ? 'This machine’s CLI was signed out too.' : null,
        result.logoutError ? `Could not sign the CLI out: ${result.logoutError}` : null,
        result.nowUsing ? `New sessions now start on ${result.nowUsing}.` : null
      ]
        .filter(Boolean)
        .join('\n')
    )
  },
  'account import': async (ctx) => {
    const agent = requiredProvider(ctx)
    const response = await ctx.client.call<{ login: SealSystemLogin; status: SealAccountsStatus }>(
      'seal.accounts.importSystemLogin',
      { provider: agent }
    )
    printResult(
      response,
      ctx.json,
      ({ login, status }) =>
        `Added this machine’s ${agent} login (${login.email}).\n\n${table(status, [agent])}`
    )
  },
  'account token add': async (ctx) => {
    const token = (await readTextOrFileFlag(ctx.flags, ctx.cwd, 'token', true))?.trim() ?? ''
    const response = await ctx.client.call<{ key: string }>('seal.accounts.addSetupToken', {
      label: getRequiredStringFlag(ctx.flags, 'label'),
      token
    })
    printResult(response, ctx.json, ({ key }) => `Stored ${key} in the keychain.`)
  },
  'account order': async (ctx) => {
    const agent = requiredProvider(ctx)
    const accounts = getRequiredStringFlag(ctx.flags, 'accounts')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.reorder', {
      provider: agent,
      accounts
    })
    printResult(response, ctx.json, (status) => table(status, [agent]))
  }
}
