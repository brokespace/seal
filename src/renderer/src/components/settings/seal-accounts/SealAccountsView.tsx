import { useState } from 'react'
import { KeyRound, Plus, RefreshCw } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { Button } from '../../ui/button'
import { SettingsGroup, SettingsGroupSubsection } from '../section-layout/SettingsGroup'
import {
  SEAL_PROVIDERS,
  type SealAccountProfile,
  type SealAutoSwapSettings,
  type SealProvider
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type {
  SealAccountsStatus,
  SealSessionLiveSwapMode
} from '../../../../../shared/seal-accounts/seal-accounts-status'
import type { SealAccountCandidate } from '../../../../../shared/seal-accounts/seal-account-candidates'
import { SealAccountRow } from './SealAccountRow'
import { SealSessionRows, SealSwapRows } from './SealActivityRows'
import { SealApiKeyDialog, SealApiKeyRows } from './SealApiKeyRows'
import { SealAutoSwapRows } from './SealAutoSwapRows'
import { SealFleetRows, type SealFleetHost } from './SealFleetRows'
import { SealPolicyRuleDialog, type SealPolicyDraft } from './SealPolicyRuleDialog'
import { SealPolicyRules, type SealPolicyRuleRef } from './SealPolicyRules'

export type SealAccountsActions = {
  refresh: () => void
  use: (provider: SealProvider, account: string) => void
  saveProfile: (account: string, profile: SealAccountProfile) => Promise<boolean>
  setAutoSwap: (provider: SealProvider, patch: Partial<SealAutoSwapSettings>) => void
  evaluate: (provider: SealProvider) => void
  savePolicy: (draft: SealPolicyDraft) => Promise<boolean>
  removePolicy: (rule: SealPolicyRuleRef) => void
  addApiKey: (input: { provider: SealProvider; label: string; apiKey: string }) => Promise<boolean>
  removeApiKey: (id: string) => void
  syncHost: (environmentId: string, includeLogins: boolean) => Promise<string | null>
  swapSession: (sessionId: string, account: string) => void
  setSessionLiveSwap: (sessionId: string, mode: SealSessionLiveSwapMode) => void
}

type SealAccountsViewProps = {
  status: SealAccountsStatus | null
  error: string | null
  refreshing: boolean
  now: number
  /** Remote hosts to sync; null when this view already shows a remote host. */
  fleetHosts: SealFleetHost[] | null
  actions: SealAccountsActions
}

export function SealAccountsView({
  status,
  error,
  refreshing,
  now,
  fleetHosts,
  actions
}: SealAccountsViewProps) {
  const t = useTranslate()
  const providerTitles: Record<SealProvider, string> = {
    claude: t('seal.accounts.provider.claudeCode', 'Claude Code'),
    codex: t('seal.accounts.provider.codex', 'Codex')
  }
  const [ruleOpen, setRuleOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)

  const refreshButton = (
    <Button variant="ghost" size="xs" onClick={actions.refresh} disabled={refreshing}>
      <RefreshCw
        className={cn('size-3', refreshing && 'animate-spin motion-reduce:animate-none')}
      />
      {t('seal.accounts.refresh', 'Refresh usage')}
    </Button>
  )

  if (!status) {
    return (
      <SettingsGroup
        title={t('seal.accounts.title', 'Accounts and auto-swap')}
        action={refreshButton}
      >
        <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
          {error ?? t('seal.accounts.loading', 'Loading accounts…')}
        </p>
      </SettingsGroup>
    )
  }

  const allCandidates = SEAL_PROVIDERS.flatMap((provider) => status.providers[provider].candidates)
  const labelOf = (key: string): string =>
    allCandidates.find((candidate) => candidate.key === key)?.label ?? key
  const candidatesByProvider: Record<SealProvider, SealAccountCandidate[]> = {
    claude: status.providers.claude.candidates,
    codex: status.providers.codex.candidates
  }
  const portableLogins = allCandidates.filter(
    (candidate) => candidate.kind === 'oauth' && candidate.launchable
  ).length

  return (
    <div className="space-y-8" data-slot="seal-accounts-dashboard">
      {SEAL_PROVIDERS.map((provider) => {
        const providerStatus = status.providers[provider]
        const settings = status.config.autoSwap[provider]
        return (
          <SettingsGroup
            key={provider}
            title={providerTitles[provider]}
            description={t(
              'seal.accounts.providerDescription',
              'Live usage per account. New sessions launch on the account marked Next launch unless a rule or override says otherwise.'
            )}
            action={provider === 'claude' ? refreshButton : undefined}
          >
            {providerStatus.candidates.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
                {t('seal.accounts.noAccounts', 'No accounts yet. Sign in below or add an API key.')}
              </p>
            ) : (
              providerStatus.candidates.map((candidate) => (
                <SealAccountRow
                  key={candidate.key}
                  candidate={candidate}
                  profile={status.config.profiles[candidate.key]}
                  settings={settings}
                  quarantine={status.quarantine[candidate.key]}
                  isMachineDefault={providerStatus.machineDefault === candidate.key}
                  now={now}
                  onUse={() => actions.use(provider, candidate.key)}
                  onSaveProfile={(profile) => actions.saveProfile(candidate.key, profile)}
                />
              ))
            )}
            <SealAutoSwapRows
              settings={settings}
              lastDecision={providerStatus.lastDecision}
              onChange={(patch) => actions.setAutoSwap(provider, patch)}
              onEvaluateNow={() => actions.evaluate(provider)}
            />
          </SettingsGroup>
        )
      })}

      <SettingsGroup
        title={t('seal.accounts.policy.title', 'Account rules')}
        description={t(
          'seal.accounts.policy.description',
          'Per-project and per-machine allow-lists and defaults. This machine is {{value0}}.',
          { value0: status.machineKey }
        )}
        action={
          <Button variant="outline" size="xs" onClick={() => setRuleOpen(true)}>
            <Plus />
            {t('seal.accounts.policy.add', 'Add rule')}
          </Button>
        }
      >
        <SealPolicyRules config={status.config} labelOf={labelOf} onRemove={actions.removePolicy} />
      </SettingsGroup>

      <SettingsGroup
        title={t('seal.accounts.keys.title', 'API keys')}
        description={t(
          'seal.accounts.keys.description',
          'Pay-as-you-go keys, encrypted with the system keychain. Use them as a fallback or pin them to a project.'
        )}
        action={
          <Button variant="outline" size="xs" onClick={() => setKeyOpen(true)}>
            <KeyRound />
            {t('seal.accounts.keys.add', 'Add key')}
          </Button>
        }
      >
        <SealApiKeyRows apiKeys={status.config.apiKeys} onRemove={actions.removeApiKey} />
      </SettingsGroup>

      {fleetHosts ? (
        <SettingsGroup
          title={t('seal.accounts.fleet.title', 'Remote hosts')}
          description={t(
            'seal.accounts.fleet.description',
            'Each SSH host swaps accounts on its own. Push your rules and logins so it can.'
          )}
        >
          <SealFleetRows hosts={fleetHosts} loginCount={portableLogins} onSync={actions.syncHost} />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t('seal.accounts.activity.title', 'Activity')}>
        <SettingsGroupSubsection title={t('seal.accounts.sessions.title', 'Recent sessions')}>
          <SealSessionRows
            sessions={status.sessions}
            providers={status.providers}
            now={now}
            onSwap={actions.swapSession}
            onSetLiveSwap={actions.setSessionLiveSwap}
          />
        </SettingsGroupSubsection>
        <SettingsGroupSubsection title={t('seal.accounts.swap.title', 'Swaps')}>
          <SealSwapRows swaps={status.swapLog} labelOf={labelOf} />
        </SettingsGroupSubsection>
      </SettingsGroup>

      <SealPolicyRuleDialog
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        candidates={candidatesByProvider}
        machineKey={status.machineKey}
        onSave={actions.savePolicy}
      />
      <SealApiKeyDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        secretStorage={status.secretStorage}
        onSave={actions.addApiKey}
      />
    </div>
  )
}
