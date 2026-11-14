import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/types'
import {
  getOptionalNumberFlag,
  getOptionalStringFlag,
  getOptionalStringFlagAllowingEmpty,
  getRequiredStringFlag
} from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import {
  SEAL_PROVIDERS,
  SEAL_SWAP_STRATEGIES,
  type SealAccountProfile,
  type SealAutoSwapSettings,
  type SealProvider
} from '../../shared/seal-accounts/seal-accounts-config'
import type {
  SealAccountsStatus,
  SealSwapEvent
} from '../../shared/seal-accounts/seal-accounts-status'
import type { SealLaunchPick } from '../../shared/seal-accounts/seal-launch-account-pick'
import { findSealProfile } from '../../shared/seal-accounts/seal-account-candidate-builder'
import {
  SEAL_ACCOUNT_KEY_ENV,
  SEAL_ACCOUNT_LABEL_ENV
} from '../../shared/seal-accounts/seal-launch-env'
import { formatPick, formatPolicies, formatSessions } from './seal-account-format'
import { formatSealAccountsTable } from './seal-account-table'

function provider(ctx: HandlerContext): SealProvider {
  const value = getRequiredStringFlag(ctx.flags, 'agent')
  const match = SEAL_PROVIDERS.find((entry) => entry === value)
  if (!match) {
    throw new RuntimeClientError('invalid_argument', '--agent must be claude or codex')
  }
  return match
}

function optionalProviders(ctx: HandlerContext): SealProvider[] {
  return ctx.flags.has('agent') ? [provider(ctx)] : [...SEAL_PROVIDERS]
}

function onOff(ctx: HandlerContext, name: string): boolean | undefined {
  const value = getOptionalStringFlag(ctx.flags, name)
  if (value === undefined) {
    return undefined
  }
  if (value !== 'on' && value !== 'off') {
    throw new RuntimeClientError('invalid_argument', `--${name} must be on or off`)
  }
  return value === 'on'
}

function list(ctx: HandlerContext, name: string): string[] | undefined {
  const value = getOptionalStringFlagAllowingEmpty(ctx.flags, name)
  return value === undefined
    ? undefined
    : value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function worktreeId(ctx: HandlerContext): string | undefined {
  return getOptionalStringFlag(ctx.flags, 'worktree-id') ?? process.env.ORCA_WORKTREE_ID
}

function policyTarget(ctx: HandlerContext): { scope: 'project' | 'machine'; target: string } {
  const project = getOptionalStringFlag(ctx.flags, 'project')
  const machine = getOptionalStringFlag(ctx.flags, 'machine')
  if (Boolean(project) === Boolean(machine)) {
    throw new RuntimeClientError('invalid_argument', 'Pass exactly one of --project or --machine')
  }
  return project ? { scope: 'project', target: project } : { scope: 'machine', target: machine! }
}

async function status(ctx: HandlerContext, refreshUsage = false) {
  return ctx.client.call<SealAccountsStatus>('seal.accounts.status', { refreshUsage })
}

function printStatus(
  ctx: HandlerContext,
  response: Awaited<ReturnType<typeof status>>,
  providers = [...SEAL_PROVIDERS]
) {
  const now = Date.now()
  printResult(response, ctx.json, (value) => formatSealAccountsTable(value, providers, now))
}

function profilePatch(
  ctx: HandlerContext,
  current: SealAccountProfile | undefined
): SealAccountProfile {
  const next: SealAccountProfile = { ...current }
  const text = (name: 'alias' | 'plan') => {
    const value = getOptionalStringFlagAllowingEmpty(ctx.flags, name)
    if (value !== undefined) {
      next[name] = value || undefined
    }
  }
  text('alias')
  text('plan')
  const priority = getOptionalNumberFlag(ctx.flags, 'priority')
  const session = getOptionalNumberFlag(ctx.flags, 'session-threshold')
  const weekly = getOptionalNumberFlag(ctx.flags, 'weekly-threshold')
  const disabled = onOff(ctx, 'disabled')
  return {
    ...next,
    ...(priority !== undefined ? { priority } : {}),
    ...(session !== undefined ? { sessionThreshold: session } : {}),
    ...(weekly !== undefined ? { weeklyThreshold: weekly } : {}),
    ...(disabled !== undefined ? { disabled } : {})
  }
}

function autoSwapPatch(ctx: HandlerContext): Partial<SealAutoSwapSettings> {
  const strategy = getOptionalStringFlag(ctx.flags, 'strategy')
  if (strategy !== undefined && !SEAL_SWAP_STRATEGIES.some((entry) => entry === strategy)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--strategy must be one of ${SEAL_SWAP_STRATEGIES.join(', ')}`
    )
  }
  const entries: [keyof SealAutoSwapSettings, unknown][] = [
    ['enabled', onOff(ctx, 'enabled')],
    ['strategy', strategy],
    ['sessionThreshold', getOptionalNumberFlag(ctx.flags, 'session-threshold')],
    ['weeklyThreshold', getOptionalNumberFlag(ctx.flags, 'weekly-threshold')],
    ['hysteresis', getOptionalNumberFlag(ctx.flags, 'hysteresis')],
    ['cooldownMinutes', getOptionalNumberFlag(ctx.flags, 'cooldown')],
    ['quarantineMinutes', getOptionalNumberFlag(ctx.flags, 'quarantine')],
    ['failoverOnAuthError', onOff(ctx, 'failover')],
    ['respectModelLimits', onOff(ctx, 'model-limits')],
    ['apiKeyFallback', onOff(ctx, 'api-key-fallback')],
    ['liveSessionSwap', onOff(ctx, 'live-sessions')],
    ['rateLimitFallback', onOff(ctx, 'rate-limit-fallback')]
  ]
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined))
}

export const SEAL_ACCOUNT_HANDLERS: Record<string, CommandHandler> = {
  'account usage': async (ctx) => {
    printStatus(ctx, await status(ctx, true), optionalProviders(ctx))
  },
  'account current': async (ctx) => {
    const providers = optionalProviders(ctx)
    const response = await status(ctx)
    printResult(response, ctx.json, (value) => {
      const session = process.env[SEAL_ACCOUNT_KEY_ENV]
      const lines = session
        ? [`this session: ${process.env[SEAL_ACCOUNT_LABEL_ENV] ?? session} (${session})`]
        : []
      for (const entry of providers) {
        const active = value.providers[entry].candidates.find((candidate) => candidate.active)
        lines.push(
          `${entry} on ${value.machineKey}: ${active ? `${active.label} (${active.key})` : 'no account'}`
        )
      }
      return lines.join('\n')
    })
  },
  'account swap': async (ctx) => {
    const response = await ctx.client.call<{ event: SealSwapEvent | null }>('seal.accounts.swap', {
      provider: provider(ctx),
      account: getOptionalStringFlag(ctx.flags, 'account')
    })
    printResult(response, ctx.json, ({ event }) =>
      event
        ? `Switched ${event.provider} to ${event.toLabel} (${event.reason}).`
        : 'No switch needed.'
    )
  },
  'account pick': async (ctx) => {
    const response = await ctx.client.call<SealLaunchPick>('seal.accounts.pick', {
      provider: provider(ctx),
      worktreeId: worktreeId(ctx),
      account: getOptionalStringFlag(ctx.flags, 'account')
    })
    printResult(response, ctx.json, formatPick)
  },
  'account alias': async (ctx) => {
    const account = getRequiredStringFlag(ctx.flags, 'account')
    const current = await status(ctx)
    const candidate = SEAL_PROVIDERS.flatMap(
      (entry) => current.result.providers[entry].candidates
    ).find((entry) => [entry.key, entry.localId, entry.label, entry.email].includes(account))
    const existing = candidate ? findSealProfile(current.result.config, candidate.key) : undefined
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.setProfile', {
      account,
      profile: profilePatch(ctx, existing)
    })
    printStatus(ctx, response)
  },
  'account autoswap': async (ctx) => {
    const agent = provider(ctx)
    const patch = autoSwapPatch(ctx)
    const response =
      Object.keys(patch).length > 0
        ? await ctx.client.call<SealAccountsStatus>('seal.accounts.setAutoSwap', {
            provider: agent,
            settings: patch
          })
        : await status(ctx)
    printResult(response, ctx.json, (value) =>
      Object.entries(value.config.autoSwap[agent])
        .map(([key, setting]) => `${key}: ${String(setting)}`)
        .join('\n')
    )
  },
  'account policy list': async (ctx) => {
    printResult(await status(ctx), ctx.json, formatPolicies)
  },
  'account policy set': async (ctx) => {
    const defaultRef = getOptionalStringFlag(ctx.flags, 'default')
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.setPolicy', {
      ...policyTarget(ctx),
      provider: provider(ctx),
      label: getOptionalStringFlagAllowingEmpty(ctx.flags, 'label'),
      allow: list(ctx, 'allow'),
      default: defaultRef === undefined ? undefined : defaultRef === 'none' ? null : defaultRef
    })
    printResult(response, ctx.json, formatPolicies)
  },
  'account policy rm': async (ctx) => {
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.setPolicy', {
      ...policyTarget(ctx),
      provider: 'claude',
      remove: true
    })
    printResult(response, ctx.json, formatPolicies)
  },
  'account pin': async (ctx) => {
    const id = worktreeId(ctx)
    if (!id) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass --worktree-id or run inside a workspace terminal'
      )
    }
    const account = getRequiredStringFlag(ctx.flags, 'account')
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.pinWorkspace', {
      worktreeId: id,
      provider: provider(ctx),
      account: account === 'none' ? null : account
    })
    printResult(response, ctx.json, (value) => {
      const pins = value.workspacePins[id]
      return pins ? `Pinned: ${JSON.stringify(pins)}` : 'No pins on this workspace.'
    })
  },
  'account key add': async (ctx) => {
    const apiKey = (await readTextOrFileFlag(ctx.flags, ctx.cwd, 'key', true))?.trim() ?? ''
    const response = await ctx.client.call<{ key: string }>('seal.accounts.addApiKey', {
      provider: provider(ctx),
      label: getRequiredStringFlag(ctx.flags, 'label'),
      apiKey
    })
    printResult(response, ctx.json, ({ key }) => `Stored ${key} in the keychain.`)
  },
  'account key rm': async (ctx) => {
    const response = await ctx.client.call<SealAccountsStatus>('seal.accounts.removeApiKey', {
      id: getRequiredStringFlag(ctx.flags, 'id')
    })
    printResult(response, ctx.json, () => 'Removed.')
  },
  'account sync': async (ctx) => {
    const response = await ctx.client.call<{
      results: {
        environmentId: string
        ok: boolean
        error: string | null
        credentials: { account: string; ok: boolean; error: string | null }[]
      }[]
    }>('seal.accounts.syncFleet', {
      environmentIds: list(ctx, 'to') ?? [],
      accounts: list(ctx, 'accounts')
    })
    printResult(response, ctx.json, ({ results }) =>
      results
        .map((result) =>
          [
            `${result.environmentId}: ${result.ok ? 'policy pushed' : `failed — ${result.error}`}`,
            ...result.credentials.map(
              (entry) =>
                `  ${entry.account}: ${entry.ok ? 'login copied' : `failed — ${entry.error}`}`
            )
          ].join('\n')
        )
        .join('\n')
    )
  },
  'account sessions': async (ctx) => {
    printResult(await status(ctx), ctx.json, formatSessions)
  }
}
