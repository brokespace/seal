import type { HandlerGroup } from '../dispatch/handler-group-manifest'

// Split from handler-group-manifest.ts to keep it under the max-lines limit.
export const SEAL_ACCOUNT_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'seal-account',
    keys: [
      'account usage',
      'account current',
      'account swap',
      'account pick',
      'account alias',
      'account autoswap',
      'account policy list',
      'account policy set',
      'account policy rm',
      'account pin',
      'account key add',
      'account key rm',
      'account sync',
      'account sessions'
    ],
    load: async () => (await import('./seal-account-commands.js')).SEAL_ACCOUNT_HANDLERS
  },
  {
    name: 'seal-account-roster',
    keys: ['account remove', 'account import', 'account token add', 'account order'],
    load: async () =>
      (await import('./seal-account-roster-commands.js')).SEAL_ACCOUNT_ROSTER_HANDLERS
  },
  {
    name: 'seal-session',
    keys: ['account session swap', 'account session live'],
    load: async () => (await import('./seal-session-commands.js')).SEAL_SESSION_HANDLERS
  }
]
