import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  SealAccountProfile,
  SealAutoSwapSettings,
  SealProvider
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type {
  SealAccountsStatus,
  SealSessionLiveSwapMode
} from '../../../../../shared/seal-accounts/seal-accounts-status'
import {
  SEAL_ACCOUNT_GROUPS,
  type SealAccountGroup,
  type SealFleetAccount,
  type SealFleetOverview
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { findSealProfile } from '../../../../../shared/seal-accounts/seal-account-candidate-builder'
import { Button } from '../../ui/button'
import { SealAccountGroupSection } from './SealAccountGroupSection'
import { SealAccountsNotices } from './SealAccountsNotices'
import { SealAccountsOnboarding } from './SealAccountsOnboarding'
import { SealSessionsSection, SealSwapHistorySection } from './SealActivitySections'
import { SealAddAccountDialog } from './SealAddAccountDialog'
import { SealAutoSwapSection } from './SealAutoSwapSection'
import { SealEditAccountDialog } from './SealEditAccountDialog'
import { SealRemoveAccountDialog, type SealRemoveAccountChoice } from './SealRemoveAccountDialog'
import { SealRulesSection } from './SealRulesSection'
import type { SealSecretInput } from './SealSecretForm'
import type { SealRuleDraft, SealRuleRef } from './seal-rule-rows'
import type { SealSignInController } from './use-seal-sign-in'

export type SealAccountsPageActions = {
  refresh: () => void
  use: (account: SealFleetAccount) => void
  /** One group's accounts in their new order of preference. */
  reorder: (accounts: SealFleetAccount[]) => void
  saveProfile: (account: SealFleetAccount, profile: SealAccountProfile) => Promise<boolean>
  remove: (account: SealFleetAccount, choice: SealRemoveAccountChoice) => Promise<boolean>
  push: (account: SealFleetAccount, machineId: string) => void
  importSystemLogin: (provider: SealProvider) => Promise<boolean>
  addSecret: (input: SealSecretInput) => Promise<boolean>
  setAutoSwap: (provider: SealProvider, patch: Partial<SealAutoSwapSettings>) => void
  evaluate: (provider: SealProvider) => void
  saveRule: (draft: SealRuleDraft) => Promise<boolean>
  removeRule: (rule: SealRuleRef) => void
  syncRules: () => Promise<string>
  swapSession: (sessionId: string, account: string) => void
  setSessionLiveSwap: (sessionId: string, mode: SealSessionLiveSwapMode) => void
  dismissNotice: () => void
}

type PageDialog =
  | { kind: 'add'; group: SealAccountGroup }
  | { kind: 'relogin'; account: SealFleetAccount }
  | { kind: 'edit'; account: SealFleetAccount }
  | { kind: 'remove'; account: SealFleetAccount }

export type SealAccountsPageViewProps = {
  overview: SealFleetOverview | null
  status: SealAccountsStatus | null
  error: string | null
  refreshing: boolean
  now: number
  signIn: SealSignInController
  actions: SealAccountsPageActions
  /** Claude-wide option rows, shown under the Claude accounts. */
  claudeOptions?: React.ReactNode
  /** For fixtures: the dialog to show on first render. */
  initialDialog?: PageDialog | null
}

/** Every Claude, Codex and API-key account in one place, with auto-swap, rules and history. */
export function SealAccountsPageView({
  overview,
  status,
  error,
  refreshing,
  now,
  signIn,
  actions,
  claudeOptions,
  initialDialog = null
}: SealAccountsPageViewProps): React.JSX.Element {
  const t = useTranslate()
  const [dialog, setDialog] = useState<PageDialog | null>(initialDialog)
  const closeDialog = (open: boolean): void => {
    if (!open) {
      setDialog(null)
    }
  }

  if (!overview || !status) {
    return (
      <p
        className={cn('py-6 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}
        role="status"
        data-slot="seal-accounts-loading"
      >
        {error ?? t('seal.accounts.loading', 'Loading accounts…')}
      </p>
    )
  }

  const allAccounts = SEAL_ACCOUNT_GROUPS.flatMap((group) => overview.groups[group])
  const pushTargets = overview.machines.filter((machine) => !machine.home && machine.reachable)
  const machineCount = overview.machines.length
  const actionsFor = (account: SealFleetAccount) => ({
    onUse: () => actions.use(account),
    onRelogin: () => setDialog({ kind: 'relogin', account }),
    onEdit: () => setDialog({ kind: 'edit', account }),
    onRemove: () => setDialog({ kind: 'remove', account }),
    onPush: (machineId: string) => actions.push(account, machineId)
  })

  return (
    <div className="space-y-8" data-slot="seal-accounts-page">
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="min-w-0 flex-1 text-sm text-muted-foreground"
          data-slot="seal-accounts-summary"
        >
          {overview.total === 0
            ? t('seal.accounts.summary.none', 'No accounts yet.')
            : machineCount > 1
              ? overview.total === 1
                ? t('seal.accounts.summary.fleetOne', '1 account across {{value0}} machines.', {
                    value0: machineCount
                  })
                : t(
                    'seal.accounts.summary.fleet',
                    '{{value0}} accounts across {{value1}} machines.',
                    { value0: overview.total, value1: machineCount }
                  )
              : overview.total === 1
                ? t('seal.accounts.summary.one', '1 account on this computer.')
                : t('seal.accounts.summary.local', '{{value0}} accounts on this computer.', {
                    value0: overview.total
                  })}
        </p>
        <Button variant="ghost" size="sm" onClick={actions.refresh} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
          {t('seal.accounts.refresh', 'Refresh usage')}
        </Button>
        <Button
          size="sm"
          onClick={() => setDialog({ kind: 'add', group: 'claude' })}
          data-slot="seal-add-account"
        >
          <Plus />
          {t('seal.accounts.add.account', 'Add account')}
        </Button>
      </div>

      <SealAccountsNotices
        overview={overview}
        status={status}
        error={error}
        onDismissNotice={actions.dismissNotice}
      />

      {overview.total === 0 ? (
        <SealAccountsOnboarding
          status={status}
          onAdd={(group) => setDialog({ kind: 'add', group })}
          onImportSystemLogin={actions.importSystemLogin}
        />
      ) : (
        <>
          {SEAL_ACCOUNT_GROUPS.map((group) => (
            <SealAccountGroupSection
              key={group}
              group={group}
              accounts={overview.groups[group]}
              status={status}
              now={now}
              pushTargets={pushTargets}
              onAdd={() => setDialog({ kind: 'add', group })}
              onReorder={actions.reorder}
              actionsFor={actionsFor}
              footer={group === 'claude' ? claudeOptions : undefined}
            />
          ))}
          <SealAutoSwapSection
            status={status}
            onChange={actions.setAutoSwap}
            onEvaluateNow={actions.evaluate}
          />
          <SealRulesSection
            status={status}
            accounts={allAccounts}
            machines={overview.machines.filter((machine) => machine.runsSeal)}
            onSave={actions.saveRule}
            onRemove={actions.removeRule}
            onSync={actions.syncRules}
          />
          <SealSessionsSection
            overview={overview}
            status={status}
            now={now}
            onSwap={actions.swapSession}
            onSetLiveSwap={actions.setSessionLiveSwap}
          />
          <SealSwapHistorySection overview={overview} />
        </>
      )}

      {dialog?.kind === 'add' || dialog?.kind === 'relogin' ? (
        <SealAddAccountDialog
          key={dialog.kind === 'add' ? `add:${dialog.group}` : `relogin:${dialog.account.key}`}
          open
          onOpenChange={closeDialog}
          initialGroup={dialog.kind === 'add' ? dialog.group : dialog.account.provider}
          relogin={dialog.kind === 'relogin' ? dialog.account : null}
          status={status}
          signIn={signIn}
          onImportSystemLogin={actions.importSystemLogin}
          onAddSecret={actions.addSecret}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <SealEditAccountDialog
          key={dialog.account.key}
          account={dialog.account}
          profile={findSealProfile(status.config, dialog.account.key)}
          onOpenChange={closeDialog}
          onSave={(profile) => actions.saveProfile(dialog.account, profile)}
        />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <SealRemoveAccountDialog
          key={dialog.account.key}
          account={dialog.account}
          onOpenChange={closeDialog}
          onConfirm={(choice) => actions.remove(dialog.account, choice)}
        />
      ) : null}
    </div>
  )
}
