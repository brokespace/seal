import React, { useState } from 'react'
import { Info, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import type {
  AgentConnectorAccount,
  AgentConnectorDuplicateGroup
} from '../../../../shared/agent-connectors/agent-connector-types'
import { parseMachineId, type MachineId } from '../../../../shared/machines/machine-types'
import { SettingsGroup, SettingsGroupSubsection } from '../settings/section-layout/SettingsGroup'
import { AgentConnectorRow } from './AgentConnectorRow'
import {
  AgentConnectorSignInDialog,
  type AgentConnectorSignInRequest
} from './AgentConnectorSignInDialog'
import { agentConnectorsApi, useAgentConnectors } from './use-agent-connectors'

const CHECKED_AT_FORMAT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

function keepReason(group: AgentConnectorDuplicateGroup, t: Translate): string {
  switch (group.reason) {
    case 'connected':
      return t('auto.components.agentConnectors.keep.connected', 'it is the one that is connected')
    case 'claude-ai':
      return t(
        'auto.components.agentConnectors.keep.claudeAi',
        'claude.ai connectors sign in once for the account on every machine'
      )
    case 'original':
      return t('auto.components.agentConnectors.keep.original', 'it is the original, not a copy')
  }
}

function DuplicateList({
  groups
}: {
  groups: readonly AgentConnectorDuplicateGroup[]
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <SettingsGroupSubsection
      title={t('auto.components.agentConnectors.duplicates', 'Possible duplicates')}
      description={t(
        'auto.components.agentConnectors.duplicatesDescription',
        'These reach the same service. Seal removes nothing: claude.ai connectors are removed on claude.ai, others in Agent configuration.'
      )}
    >
      <ul className="space-y-2 pb-3">
        {groups.map((group) => (
          <li key={group.names.join('\0')} className="space-y-0.5 text-xs">
            <p className="font-mono [overflow-wrap:anywhere]">{group.names.join(', ')}</p>
            <p className="text-muted-foreground">
              {t('auto.components.agentConnectors.keepSuggestion', 'Keep {{name}}: {{reason}}.', {
                name: group.keep,
                reason: keepReason(group, t)
              })}
            </p>
          </li>
        ))}
      </ul>
    </SettingsGroupSubsection>
  )
}

function accountDescription(account: AgentConnectorAccount, t: Translate): string {
  const agent = account.agent === 'claude' ? 'Claude Code' : 'Codex'
  const source = account.isDefault
    ? t('auto.components.agentConnectors.defaultConfig', '{{agent}} default config', { agent })
    : t('auto.components.agentConnectors.sealAccount', '{{agent}} account in Seal', { agent })
  return account.email && account.email !== account.label ? `${source} · ${account.email}` : source
}

function AccountGroup({
  account,
  checking,
  onSignIn
}: {
  account: AgentConnectorAccount
  checking: boolean
  onSignIn: (name: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <SettingsGroup
      title={account.label}
      description={accountDescription(account, t)}
      action={checking ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
    >
      <div data-agent-connectors-account={account.id}>
        {account.claudeAiConnectorsDisabled ? (
          <p
            data-settings-row=""
            className="flex items-start gap-2 py-2.5 text-xs text-muted-foreground"
          >
            <Info className="mt-px size-3.5 shrink-0" />
            {t(
              'auto.components.agentConnectors.claudeAiDisabled',
              'claude.ai connectors are not listed: disableClaudeAiConnectors is set in this account’s Claude settings.'
            )}
          </p>
        ) : null}
        {account.error ? (
          <p
            data-settings-row=""
            className="py-2.5 text-xs text-destructive [overflow-wrap:anywhere]"
          >
            {account.error}
          </p>
        ) : null}
        {account.connectors.map((connector) => (
          <AgentConnectorRow
            key={connector.name}
            connector={connector}
            onSignIn={() => onSignIn(connector.name)}
          />
        ))}
        {account.connectors.length === 0 && !account.error ? (
          <p data-settings-row="" className="py-2.5 text-xs text-muted-foreground">
            {t('auto.components.agentConnectors.none', 'No connectors for this account.')}
          </p>
        ) : null}
        {account.duplicates.length > 0 ? <DuplicateList groups={account.duplicates} /> : null}
      </div>
    </SettingsGroup>
  )
}

/** Each account's MCP connectors on one machine, as the agents there see them, with sign-in. */
export function AgentConnectorsSection({
  machineId,
  machineLabel
}: {
  machineId: string
  /** Names the machine in the sign-in dialog. */
  machineLabel?: string
}): React.JSX.Element {
  const t = useTranslate()
  const parsed: MachineId = parseMachineId(machineId) ?? 'local'
  const connectors = useAgentConnectors(parsed)
  const [signIn, setSignIn] = useState<AgentConnectorSignInRequest | null>(null)
  const { snapshot, checking } = connectors

  if (!agentConnectorsApi()) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('auto.components.agentConnectors.desktopOnly', 'Agent connectors need the desktop app.')}
      </p>
    )
  }

  return (
    <div className="space-y-6" data-agent-connectors={parsed}>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground" role="status">
          {checking
            ? t(
                'auto.components.agentConnectors.checking',
                'Checking every account on this machine. Each agent contacts all of its servers, so this can take a minute.'
              )
            : snapshot
              ? t('auto.components.agentConnectors.checkedAt', 'Checked at {{time}}.', {
                  time: uiDateTimeFormat(CHECKED_AT_FORMAT).format(snapshot.checkedAt)
                })
              : null}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-28 shrink-0"
          disabled={checking}
          onClick={connectors.refresh}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t('auto.components.agentConnectors.refresh', 'Check again')}
        </Button>
      </div>
      {connectors.error ? (
        <p role="alert" className="px-1 text-xs text-destructive [overflow-wrap:anywhere]">
          {connectors.error}
        </p>
      ) : null}
      {snapshot && snapshot.accounts.length === 0 && !checking ? (
        <p className="px-1 text-xs text-muted-foreground">
          {t(
            'auto.components.agentConnectors.noAgents',
            'Neither Claude Code nor Codex is installed on this machine.'
          )}
        </p>
      ) : null}
      {snapshot?.accounts.map((account) => (
        <AccountGroup
          key={account.id}
          account={account}
          checking={connectors.checkingAccounts.has(account.id)}
          onSignIn={(name) =>
            setSignIn({ accountId: account.id, accountLabel: account.label, name })
          }
        />
      ))}
      {signIn ? (
        <AgentConnectorSignInDialog
          machineId={parsed}
          machineLabel={
            machineLabel ?? t('auto.components.agentConnectors.agentMachine', 'the agent’s machine')
          }
          request={signIn}
          onClose={() => setSignIn(null)}
          onSignedIn={() => void connectors.refreshAccount(signIn.accountId)}
        />
      ) : null}
    </div>
  )
}
