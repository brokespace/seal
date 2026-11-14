import React, { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { sealAccountIdentity } from '@/components/settings/seal-accounts/seal-account-presentation'
import type { SealAccountCandidate } from '../../../../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import {
  agentSessionAccountHost,
  agentSessionAccountProvider,
  type AgentSessionAccountChoice
} from './agent-session-account-choice'

const AUTOMATIC = 'automatic'

type Reading = { hostId: string; status: SealAccountsStatus | null; error: string | null }

function canStartSessions(candidate: SealAccountCandidate): boolean {
  return candidate.launchable && !candidate.disabled && candidate.health?.state !== 'dead'
}

/** The account one new session runs on; Automatic leaves the pick to the machine's rules. */
export function AgentSessionAccountField({
  agent,
  agentLabel,
  executionHostId,
  value,
  onChange
}: {
  agent: TuiAgent | null
  agentLabel: string | null
  executionHostId: string | null | undefined
  value: AgentSessionAccountChoice | null
  onChange: (choice: AgentSessionAccountChoice | null) => void
}): React.JSX.Element {
  const t = useTranslate()
  const provider = agentSessionAccountProvider(agent)
  const host = agentSessionAccountHost(executionHostId)
  const hostId = host?.hostId ?? null
  const target = host?.target ?? null
  const [reading, setReading] = useState<Reading | null>(null)

  useEffect(() => {
    const machine = agentSessionAccountHost(executionHostId)
    const runtime = machine?.target
    if (!machine || !runtime || !provider) {
      return
    }
    let current = true
    callRuntimeRpc<SealAccountsStatus>(
      runtime,
      'seal.accounts.status',
      { refreshUsage: false },
      { timeoutMs: 20_000 }
    ).then(
      (status) => current && setReading({ hostId: machine.hostId, status, error: null }),
      (caught: unknown) =>
        current &&
        setReading({
          hostId: machine.hostId,
          status: null,
          error: caught instanceof Error ? caught.message : String(caught)
        })
    )
    return () => {
      current = false
    }
  }, [executionHostId, provider])

  const current = reading?.hostId === hostId ? reading : null
  const candidates =
    provider && current?.status
      ? current.status.providers[provider].candidates.filter(canStartSessions)
      : []
  const chosen =
    value && value.provider === provider && value.hostId === hostId
      ? (candidates.find((candidate) => candidate.key === value.key) ?? null)
      : null
  const managed = provider !== null && target !== null

  const hint = !provider
    ? agent
      ? t(
          'components.newAgentSession.accountUnmanagedAgent',
          'Seal picks accounts for Claude Code and Codex. {{agent}} uses its own login.',
          { agent: agentLabel ?? agent }
        )
      : null
    : !target
      ? t(
          'components.newAgentSession.accountSshOnly',
          'This machine is reached over SSH only, so the agent uses the login on that machine.'
        )
      : current?.error
        ? t(
            'components.newAgentSession.accountReadFailed',
            'Could not read this machine’s accounts: {{error}}',
            { error: current.error }
          )
        : chosen
          ? t(
              'components.newAgentSession.accountTerminalOnly',
              'Starts in a terminal, where the session can run on a chosen account.'
            )
          : null

  return (
    <div className="min-w-0 space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t('components.newAgentSession.account', 'Account')}
      </label>
      <Select
        value={chosen?.key ?? AUTOMATIC}
        disabled={!managed}
        onValueChange={(next) =>
          onChange(
            next === AUTOMATIC || !provider || !hostId ? null : { key: next, provider, hostId }
          )
        }
      >
        <SelectTrigger
          className="h-9 w-full"
          aria-label={t('components.newAgentSession.account', 'Account')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTOMATIC}>
            {managed
              ? t('components.newAgentSession.accountAutomatic', 'Automatic (rules and usage)')
              : t('components.newAgentSession.accountMachineLogin', 'The machine’s own login')}
          </SelectItem>
          {candidates.map((candidate) => {
            const identity = sealAccountIdentity(candidate, t)
            return (
              <SelectItem key={candidate.key} value={candidate.key}>
                {identity ? `${candidate.label} · ${identity}` : candidate.label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
