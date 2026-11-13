import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import {
  SEAL_PROVIDERS,
  type SealAccountProfile
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import { SealAccountsView, type SealAccountsActions } from './SealAccountsView'
import { useSealAccounts } from './use-seal-accounts'

type SyncResult = {
  results: {
    environmentId: string
    ok: boolean
    error: string | null
    credentials: { account: string; ok: boolean; error: string | null }[]
  }[]
}

function isEmptyProfile(profile: SealAccountProfile): boolean {
  return Object.values(profile).every((value) => value === undefined)
}

/** Seal's account vault, policies and auto-swap for the host these settings target. */
export function SealAccountsDashboard({ target }: { target: RuntimeClientTarget }) {
  const t = useTranslate()
  const { status, readAt, error, refreshing, refresh, mutate } = useSealAccounts(target)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const fleetHosts = useMemo(
    () =>
      target.kind === 'local'
        ? runtimeEnvironments.map((environment) => ({
            id: environment.id,
            label: environment.name
          }))
        : null,
    [runtimeEnvironments, target.kind]
  )

  const failed = t('seal.accounts.error', 'Could not update accounts')
  const actions: SealAccountsActions = {
    refresh: () => void refresh(true),
    use: (provider, account) => void mutate('seal.accounts.swap', { provider, account }, failed),
    saveProfile: (account, profile) =>
      mutate(
        'seal.accounts.setProfile',
        { account, profile: isEmptyProfile(profile) ? null : profile },
        failed
      ),
    setAutoSwap: (provider, settings) =>
      void mutate('seal.accounts.setAutoSwap', { provider, settings }, failed),
    evaluate: (provider) => void mutate('seal.accounts.swap', { provider }, failed),
    savePolicy: (draft) =>
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
    removePolicy: (rule) =>
      void mutate('seal.accounts.setPolicy', { ...rule, remove: true }, failed),
    addApiKey: (input) => mutate('seal.accounts.addApiKey', input, failed),
    removeApiKey: (id) => void mutate('seal.accounts.removeApiKey', { id }, failed),
    swapSession: (sessionId, account) =>
      void mutate(
        'seal.accounts.swapSession',
        { sessionId, account },
        t('seal.session.error.swap', 'Could not switch this session')
      ),
    setSessionLiveSwap: (sessionId, mode) =>
      void mutate('seal.accounts.setSessionLiveSwap', { sessionId, mode }, failed),
    syncHost: async (environmentId, includeLogins) => {
      const accounts = includeLogins
        ? SEAL_PROVIDERS.flatMap((provider) => status?.providers[provider].candidates ?? [])
            .filter((candidate) => candidate.kind === 'oauth' && candidate.launchable)
            .map((candidate) => candidate.key)
        : undefined
      try {
        const { results } = await callRuntimeRpc<SyncResult>(
          target,
          'seal.accounts.syncFleet',
          { environmentIds: [environmentId], ...(accounts ? { accounts } : {}) },
          { timeoutMs: 120_000 }
        )
        const result = results[0]
        if (!result?.ok) {
          return t('seal.accounts.fleet.failed', 'Sync failed: {{value0}}', {
            value0: result?.error ?? ''
          })
        }
        const copied = result.credentials.filter((credential) => credential.ok).length
        const failedLogins = result.credentials.length - copied
        return failedLogins > 0
          ? t(
              'seal.accounts.fleet.partial',
              'Rules synced; {{value0}} logins copied, {{value1}} failed.',
              {
                value0: copied,
                value1: failedLogins
              }
            )
          : t('seal.accounts.fleet.done', 'Rules synced; {{value0}} logins copied.', {
              value0: copied
            })
      } catch (caught) {
        return t('seal.accounts.fleet.failed', 'Sync failed: {{value0}}', {
          value0: caught instanceof Error ? caught.message : String(caught)
        })
      }
    }
  }

  return (
    <SealAccountsView
      status={status}
      error={error}
      refreshing={refreshing}
      now={readAt}
      fleetHosts={fleetHosts}
      actions={actions}
    />
  )
}
