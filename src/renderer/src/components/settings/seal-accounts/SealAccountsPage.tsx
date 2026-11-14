import { useMemo } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { getLocalExecutionHostLabel } from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import {
  SEAL_PROVIDERS,
  type SealAccountProfile
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { useMachinesInventory } from '../../machines/model/use-machines-inventory'
import { SealAccountsPageView, type SealAccountsPageActions } from './SealAccountsPageView'
import { useSealFleet, type SealRemoteMachine } from './use-seal-fleet'
import { useSealSignIn } from './use-seal-sign-in'

type SyncResult = {
  results: {
    environmentId: string
    ok: boolean
    error: string | null
    policyApplied?: boolean
    credentials: { account: string; ok: boolean; error: string | null }[]
  }[]
}

type RemoveResult = {
  result: { label: string; loggedOut: boolean; logoutError: string | null; nowUsing: string | null }
  status: SealAccountsStatus
}

const NO_REMOTES: readonly SealRemoteMachine[] = []
const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

/** A paired Seal server manages its own accounts; a machine reached over SSH only takes logins. */
function sealRemoteMachine(machine: MachineSummary): SealRemoteMachine[] {
  if (machine.connection === 'server' && machine.runtimeEnvironmentId) {
    return [{ id: machine.runtimeEnvironmentId, label: machine.label }]
  }
  if (machine.connection === 'ssh') {
    return [
      {
        id: machine.id,
        label: machine.label,
        loginsOnly: { connected: machine.status === 'online' }
      }
    ]
  }
  return []
}

function isEmptyProfile(profile: SealAccountProfile): boolean {
  return Object.values(profile).every((value) => value === undefined)
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

type SealAccountsPageProps = {
  target: RuntimeClientTarget
  /** Claude-wide option rows, shown under the Claude accounts. */
  claudeOptions?: React.ReactNode
}

function SealAccountsPageForHost({
  target,
  remotes,
  claudeOptions
}: SealAccountsPageProps & { remotes: readonly SealRemoteMachine[] }): React.JSX.Element {
  const t = useTranslate()
  const homeLabel =
    target.kind === 'local'
      ? t('seal.accounts.machine.thisComputer', 'This computer')
      : t('seal.accounts.machine.thisServer', 'This server')
  const fleet = useSealFleet(target, homeLabel, remotes)
  const { mutate, mutateOn, refresh } = fleet
  const signIn = useSealSignIn(target, () => void refresh(true))
  const failed = t('seal.accounts.error', 'Could not update accounts')
  const labelOfMachine = (id: string): string =>
    remotes.find((machine) => machine.id === id)?.label ?? id

  const sync = async (machineIds: string[], accounts?: string[]): Promise<SyncResult> => {
    const loginsOnly = (id: string): boolean =>
      remotes.some((machine) => machine.id === id && machine.loginsOnly)
    return callRuntimeRpc<SyncResult>(
      target,
      'seal.accounts.syncFleet',
      {
        environmentIds: machineIds.filter((id) => !loginsOnly(id)),
        machineIds: machineIds.filter(loginsOnly),
        ...(accounts ? { accounts } : {})
      },
      { timeoutMs: 120_000 }
    )
  }

  const actions: SealAccountsPageActions = {
    refresh: () => void refresh(true),
    use: (account) =>
      void mutate(
        'seal.accounts.swap',
        { provider: account.provider, account: account.key },
        failed
      ),
    reorder: (accounts) => {
      for (const provider of SEAL_PROVIDERS) {
        const keys = accounts.filter((entry) => entry.provider === provider).map((e) => e.key)
        if (keys.length > 0) {
          void mutate('seal.accounts.reorder', { provider, accounts: keys }, failed)
        }
      }
    },
    saveProfile: (account, profile) =>
      mutate(
        'seal.accounts.setProfile',
        { account: account.key, profile: isEmptyProfile(profile) ? null : profile },
        failed
      ),
    remove: async (account, choice) => {
      const params = { account: account.key, provider: account.provider }
      const removals = await Promise.all(
        choice.machineIds.map((id) =>
          mutateOn(
            id,
            'seal.accounts.removeAccount',
            params,
            t('seal.accounts.remove.failedOn', 'Could not remove it from {{value0}}', {
              value0: labelOfMachine(id)
            })
          )
        )
      )
      if (!account.onHome) {
        return removals.every(Boolean)
      }
      try {
        const { result } = await callRuntimeRpc<RemoveResult>(
          target,
          'seal.accounts.removeAccount',
          { ...params, logout: choice.logout },
          { timeoutMs: 60_000 }
        )
        await refresh(false)
        if (result.logoutError) {
          toast.warning(
            t(
              'seal.accounts.remove.logoutFailed',
              'Removed {{value0}} from Seal, but could not sign this computer out',
              { value0: result.label }
            ),
            { description: result.logoutError }
          )
        } else {
          toast.success(
            result.loggedOut
              ? t('seal.accounts.remove.doneLoggedOut', 'Removed {{value0}} and signed out', {
                  value0: result.label
                })
              : t('seal.accounts.remove.done', 'Removed {{value0}}', { value0: result.label }),
            result.nowUsing
              ? {
                  description: t(
                    'seal.accounts.remove.nowUsing',
                    'New sessions now start on {{value0}}.',
                    { value0: result.nowUsing }
                  )
                }
              : undefined
          )
        }
        return true
      } catch (caught) {
        toast.error(failed, { description: errorText(caught) })
        return false
      }
    },
    push: (account, machineId) => {
      const machine = labelOfMachine(machineId)
      void sync([machineId], [account.key])
        .then(async ({ results }) => {
          const result = results[0]
          const login = result?.credentials[0]
          if (!result?.ok || !login?.ok) {
            throw new Error(result?.error ?? login?.error ?? '')
          }
          // Pushing to a machine without a Seal server shows up in this computer's own record.
          await refresh(false)
          toast.success(
            t('seal.accounts.push.done', 'Pushed {{value0}} to {{value1}}', {
              value0: account.candidate.label,
              value1: machine
            }),
            result.policyApplied === false
              ? {
                  description: t(
                    'seal.accounts.push.loginOnly',
                    'Sessions there can use this login. Rules and auto-swap run only where a Seal server runs.'
                  )
                }
              : undefined
          )
        })
        .catch((caught: unknown) =>
          toast.error(
            t('seal.accounts.push.failed', 'Could not push {{value0}} to {{value1}}', {
              value0: account.candidate.label,
              value1: machine
            }),
            { description: errorText(caught) }
          )
        )
    },
    importSystemLogin: (provider) =>
      mutate('seal.accounts.importSystemLogin', { provider }, failed),
    addSecret: (input) =>
      input.kind === 'setup-token'
        ? mutate('seal.accounts.addSetupToken', { label: input.label, token: input.secret }, failed)
        : mutate(
            'seal.accounts.addApiKey',
            { provider: input.provider, label: input.label, apiKey: input.secret },
            failed
          ),
    setAutoSwap: (provider, settings) =>
      void mutate('seal.accounts.setAutoSwap', { provider, settings }, failed),
    evaluate: (provider) => void mutate('seal.accounts.swap', { provider }, failed),
    saveRule: (draft) =>
      mutate(
        'seal.accounts.setPolicy',
        {
          scope: draft.scope,
          target: draft.target,
          provider: draft.provider,
          ...(draft.label ? { label: draft.label } : {}),
          allow: draft.allow,
          default: draft.default
        },
        failed
      ),
    removeRule: (rule) =>
      void mutate(
        'seal.accounts.setPolicy',
        { scope: rule.scope, target: rule.target, provider: rule.provider, remove: true },
        failed
      ),
    syncRules: async () => {
      try {
        const { results } = await sync(
          remotes.filter((machine) => !machine.loginsOnly).map((machine) => machine.id)
        )
        const failures = results.filter((result) => !result.ok)
        return failures.length === 0
          ? t('seal.accounts.rules.synced', 'Rules and auto-swap settings pushed to {{value0}}.', {
              value0: results.map((result) => labelOfMachine(result.environmentId)).join(', ')
            })
          : t('seal.accounts.rules.syncFailed', 'Could not reach {{value0}}: {{value1}}', {
              value0: failures.map((result) => labelOfMachine(result.environmentId)).join(', '),
              value1: failures[0]?.error ?? ''
            })
      } catch (caught) {
        return t('seal.accounts.rules.syncError', 'Sync failed: {{value0}}', {
          value0: errorText(caught)
        })
      }
    },
    swapSession: (sessionId, account) =>
      void mutate(
        'seal.accounts.swapSession',
        { sessionId, account },
        t('seal.session.error.swap', 'Could not switch this session')
      ),
    setSessionLiveSwap: (sessionId, mode) =>
      void mutate('seal.accounts.setSessionLiveSwap', { sessionId, mode }, failed),
    dismissNotice: () => void mutate('seal.accounts.dismissNotice', {}, failed)
  }

  return (
    <SealAccountsPageView
      overview={fleet.overview}
      status={fleet.status}
      error={fleet.error}
      refreshing={fleet.refreshing}
      now={fleet.readAt}
      signIn={signIn}
      actions={actions}
      claudeOptions={claudeOptions}
    />
  )
}

/** The desktop manages the fleet: its own accounts plus the copies on every paired machine. */
function SealAccountsPageForFleet({
  claudeOptions
}: Pick<SealAccountsPageProps, 'claudeOptions'>): React.JSX.Element {
  const { machines } = useMachinesInventory(getLocalExecutionHostLabel())
  // Keyed by content: the inventory rebuilds its list on every status tick.
  const key = JSON.stringify(machines.flatMap(sealRemoteMachine))
  const remotes = useMemo<readonly SealRemoteMachine[]>(() => {
    const parsed: SealRemoteMachine[] = JSON.parse(key)
    return parsed.length > 0 ? parsed : NO_REMOTES
  }, [key])
  return (
    <SealAccountsPageForHost
      target={LOCAL_TARGET}
      remotes={remotes}
      claudeOptions={claudeOptions}
    />
  )
}

/** Seal's accounts page. A web client manages the server it is served from. */
export function SealAccountsPage({
  target,
  claudeOptions
}: SealAccountsPageProps): React.JSX.Element {
  return target.kind === 'local' && window.api.machines ? (
    <SealAccountsPageForFleet claudeOptions={claudeOptions} />
  ) : (
    <SealAccountsPageForHost target={target} remotes={NO_REMOTES} claudeOptions={claudeOptions} />
  )
}
