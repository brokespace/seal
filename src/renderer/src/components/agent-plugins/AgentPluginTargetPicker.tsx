import React, { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { AGENT_CONFIG_LAYOUTS } from '../../../../shared/agent-config/agent-config-catalog'
import {
  agentPluginSystemAccount,
  type AgentPluginTargetList,
  type AgentPluginTargets
} from '../../../../shared/agent-plugins/agent-plugin-types'
import type { AgentConfigAgentId } from '../../../../shared/agent-config/agent-config-types'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { SEAL_PROVIDERS } from '../../../../shared/seal-accounts/seal-accounts-config'
import { useLocalSealAccounts } from '../live-sessions/menu/live-session-accounts'

export type AgentPluginTargetOption<T extends string = string> = {
  id: T
  label: string
  disabled?: boolean
}

export type AgentPluginTargetOptions = {
  machines: AgentPluginTargetOption<MachineId>[]
  accounts: AgentPluginTargetOption[]
  agents: AgentPluginTargetOption<AgentConfigAgentId>[]
}

/** Each Claude and Codex account Seal runs here by its Seal label, plus each agent's own login. */
export function useAgentPluginTargetOptions(
  machines: readonly MachineSummary[]
): AgentPluginTargetOptions {
  const t = useTranslate()
  const snapshot = useLocalSealAccounts()
  const accounts = SEAL_PROVIDERS.flatMap((provider) => {
    const candidates = snapshot?.status.providers[provider].candidates ?? []
    const named = candidates
      .filter((candidate) => candidate.kind === 'oauth')
      .map((candidate) => ({ id: candidate.key, label: candidate.label }))
    return [
      {
        id: agentPluginSystemAccount(provider),
        label: t('seal.agentPlugins.targets.systemLogin', '{{agent}}: this machine’s own login', {
          agent: provider === 'claude' ? 'Claude Code' : 'Codex'
        })
      },
      ...named
    ]
  })
  return {
    machines: machines.map((machine) => ({
      id: machine.id,
      label: machine.label,
      disabled: machine.status !== 'online'
    })),
    accounts,
    agents: AGENT_CONFIG_LAYOUTS.map((layout) => ({ id: layout.id, label: layout.label }))
  }
}

function count<T extends string>(list: AgentPluginTargetList<T>, total: number): number {
  return list === 'all' ? total : list.length
}

/** "All machines · 3 of 5 accounts", or one phrase when nothing is narrowed. */
export function agentPluginTargetsSummary(
  targets: AgentPluginTargets,
  options: AgentPluginTargetOptions,
  t: Translate
): string {
  if (targets.machines === 'all' && targets.accounts === 'all' && targets.agents === 'all') {
    return t('seal.agentPlugins.targets.everywhere', 'Every machine, account and agent')
  }
  const part = (list: AgentPluginTargetList<string>, total: number, noun: string): string =>
    list === 'all'
      ? t('seal.agentPlugins.targets.allOf', 'All {{noun}}', { noun })
      : t('seal.agentPlugins.targets.someOf', '{{count}} of {{total}} {{noun}}', {
          count: count(list, total),
          total,
          noun
        })
  return [
    part(
      targets.machines,
      options.machines.length,
      t('seal.agentPlugins.targets.machines', 'machines')
    ),
    part(
      targets.accounts,
      options.accounts.length,
      t('seal.agentPlugins.targets.accounts', 'accounts')
    ),
    part(targets.agents, options.agents.length, t('seal.agentPlugins.targets.agents', 'agents'))
  ].join(' · ')
}

function TargetChecklist<T extends string>({
  title,
  value,
  options,
  onChange
}: {
  title: string
  value: AgentPluginTargetList<T>
  options: readonly AgentPluginTargetOption<T>[]
  onChange: (value: AgentPluginTargetList<T>) => void
}): React.JSX.Element {
  const t = useTranslate()
  const id = useId()
  const checked = (option: T): boolean => value === 'all' || value.includes(option)
  const toggle = (option: T, on: boolean): void => {
    const current = value === 'all' ? options.map((item) => item.id) : value
    onChange(on ? [...current, option] : current.filter((item) => item !== option))
  }
  return (
    <fieldset className="space-y-1.5" data-agent-plugin-targets={title}>
      <legend className="text-xs font-medium text-muted-foreground">{title}</legend>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-all`}
          checked={value === 'all' ? true : value.length > 0 ? 'indeterminate' : false}
          onCheckedChange={(on) => onChange(on === true ? 'all' : [])}
        />
        <Label htmlFor={`${id}-all`}>
          {t('seal.agentPlugins.targets.all', 'All, including ones added later')}
        </Label>
      </div>
      {options.map((option, index) => (
        <div key={option.id} className="flex items-center gap-2 pl-6">
          <Checkbox
            id={`${id}-${index}`}
            checked={checked(option.id)}
            disabled={option.disabled}
            onCheckedChange={(on) => toggle(option.id, on === true)}
          />
          <Label htmlFor={`${id}-${index}`} className="min-w-0">
            {option.label}
          </Label>
        </div>
      ))}
    </fieldset>
  )
}

/** Machines, accounts and agents a plugin applies to; every list starts at "All". */
export function AgentPluginTargetPicker({
  value,
  options,
  onChange
}: {
  value: AgentPluginTargets
  options: AgentPluginTargetOptions
  onChange: (value: AgentPluginTargets) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TargetChecklist
        title={t('seal.agentPlugins.targets.machinesTitle', 'Machines')}
        value={value.machines}
        options={options.machines}
        onChange={(machines) => onChange({ ...value, machines })}
      />
      <TargetChecklist
        title={t('seal.agentPlugins.targets.accountsTitle', 'Accounts')}
        value={value.accounts}
        options={options.accounts}
        onChange={(accounts) => onChange({ ...value, accounts })}
      />
      <TargetChecklist
        title={t('seal.agentPlugins.targets.agentsTitle', 'Agents')}
        value={value.agents}
        options={options.agents}
        onChange={(agents) => onChange({ ...value, agents })}
      />
    </div>
  )
}
