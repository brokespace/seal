import { useState } from 'react'
import { Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type {
  SealFleetAccount,
  SealFleetMachine
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { sealAccountKeysMatch } from '../../../../../shared/seal-accounts/seal-account-key'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { SealRuleDialog } from './SealRuleDialog'
import {
  sealMachineRuleKey,
  sealRuleRows,
  type SealRuleDraft,
  type SealRuleRef,
  type SealRuleRow
} from './seal-rule-rows'

type SealRulesSectionProps = {
  status: SealAccountsStatus
  accounts: readonly SealFleetAccount[]
  machines: readonly SealFleetMachine[]
  onSave: (draft: SealRuleDraft) => Promise<boolean>
  onRemove: (rule: SealRuleRef) => void
  /** Pushes rules and auto-swap settings to every other machine; resolves with a summary. */
  onSync: () => Promise<string>
}

/** Which accounts a project or a machine may use, in plain sentences. */
export function SealRulesSection({
  status,
  accounts,
  machines,
  onSave,
  onRemove,
  onSync
}: SealRulesSectionProps): React.JSX.Element {
  const t = useTranslate()
  const [editing, setEditing] = useState<SealRuleRow | 'new' | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const rows = sealRuleRows(status.config)
  const remotes = machines.filter((machine) => !machine.home)
  const labelOf = (key: string): string =>
    accounts.find((account) => sealAccountKeysMatch(account.key, key))?.candidate.label ?? key
  const machineLabel = (key: string): string =>
    machines.find((machine) => sealMachineRuleKey(machine, status.machineKey) === key)?.label ?? key

  const sync = async (): Promise<void> => {
    setSyncing(true)
    setSyncResult(await onSync())
    setSyncing(false)
  }

  return (
    <SettingsGroup
      id="seal-accounts-rules"
      title={t('seal.accounts.rules.title', 'Rules')}
      description={t(
        'seal.accounts.rules.description',
        'Limit which accounts a project or a machine may use, and which one it prefers. Without a rule, every account may be used everywhere.'
      )}
      action={
        <div className="flex gap-2">
          {remotes.length > 0 ? (
            <Button variant="ghost" size="xs" disabled={syncing} onClick={() => void sync()}>
              <Send />
              {t('seal.accounts.rules.sync', 'Sync to machines')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={() => setEditing('new')}
            data-slot="seal-add-rule"
          >
            <Plus />
            {t('seal.accounts.rules.add', 'Add rule')}
          </Button>
        </div>
      }
    >
      {syncResult ? (
        <p role="status" className="py-2 text-xs text-muted-foreground" data-settings-row="">
          {syncResult}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
          {t(
            'seal.accounts.rules.empty',
            'No rules yet. Add one to keep a client’s repos on a work account, or a shared machine on a single login.'
          )}
        </p>
      ) : (
        rows.map((row) => {
          const allowed = row.policy.allow?.length ? row.policy.allow.map(labelOf).join(', ') : null
          const preferred = row.policy.default ? labelOf(row.policy.default) : null
          const name =
            row.scope === 'machine'
              ? (row.label ?? machineLabel(row.target))
              : (row.label ?? row.target)
          return (
            <div
              key={`${row.scope}:${row.target}:${row.provider}`}
              className="flex items-start gap-3 py-3"
              data-settings-row=""
              data-slot="seal-rule-row"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{name}</span>
                  <Badge variant="outline">
                    {row.scope === 'project'
                      ? t('seal.accounts.rules.project', 'Project')
                      : t('seal.accounts.rules.machine', 'Machine')}
                  </Badge>
                  <Badge variant="secondary">
                    {row.provider === 'claude'
                      ? t('seal.accounts.group.claude', 'Claude')
                      : t('seal.accounts.group.codex', 'Codex')}
                  </Badge>
                </div>
                {row.scope === 'project' && row.label ? (
                  <p className="truncate font-mono text-2xs text-muted-foreground">{row.target}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {[
                    allowed
                      ? t('seal.accounts.rules.mayUse', 'May use {{value0}}.', { value0: allowed })
                      : t('seal.accounts.rules.mayUseAny', 'May use any account.'),
                    preferred
                      ? t('seal.accounts.rules.prefers', 'Prefers {{value0}}.', {
                          value0: preferred
                        })
                      : t(
                          'seal.accounts.rules.prefersBest',
                          'Picks the one with the most headroom.'
                        )
                  ].join(' ')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('seal.accounts.rules.edit', 'Edit rule for {{value0}}', {
                  value0: name
                })}
                onClick={() => setEditing(row)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('seal.accounts.rules.remove', 'Remove rule for {{value0}}', {
                  value0: name
                })}
                onClick={() => onRemove(row)}
              >
                <Trash2 />
              </Button>
            </div>
          )
        })
      )}
      {editing ? (
        <SealRuleDialog
          key={editing === 'new' ? 'new' : `${editing.scope}:${editing.target}:${editing.provider}`}
          rule={editing === 'new' ? null : editing}
          accounts={accounts}
          machines={machines}
          homeMachineKey={status.machineKey}
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          onSave={onSave}
        />
      ) : null}
    </SettingsGroup>
  )
}
