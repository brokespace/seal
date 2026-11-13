import { Trash2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { SettingsRow } from '../form-controls/SettingsFormControls'
import {
  SEAL_PROVIDERS,
  type SealAccountsConfig,
  type SealProvider,
  type SealScopePolicy
} from '../../../../../shared/seal-accounts/seal-accounts-config'

export type SealPolicyRuleRef = {
  scope: 'project' | 'machine'
  target: string
  provider: SealProvider
}

type RuleRow = SealPolicyRuleRef & { label: string; policy: SealScopePolicy }

function flattenRules(config: SealAccountsConfig): RuleRow[] {
  const rows: RuleRow[] = []
  for (const rule of config.machines) {
    for (const provider of SEAL_PROVIDERS) {
      const policy = rule[provider]
      if (policy) {
        rows.push({
          scope: 'machine',
          target: rule.machine,
          provider,
          label: rule.label ?? rule.machine,
          policy
        })
      }
    }
  }
  for (const rule of config.projects) {
    for (const provider of SEAL_PROVIDERS) {
      const policy = rule[provider]
      if (policy) {
        rows.push({
          scope: 'project',
          target: rule.match,
          provider,
          label: rule.label ?? rule.match,
          policy
        })
      }
    }
  }
  return rows
}

type SealPolicyRulesProps = {
  config: SealAccountsConfig
  labelOf: (key: string) => string
  onRemove: (rule: SealPolicyRuleRef) => void
}

/** Every machine and project rule, machine rules first since project rules narrow them. */
export function SealPolicyRules({ config, labelOf, onRemove }: SealPolicyRulesProps) {
  const t = useTranslate()
  const rows = flattenRules(config)
  if (rows.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
        {t(
          'seal.accounts.policy.empty',
          'No rules: every project and machine may use every account.'
        )}
      </p>
    )
  }
  return rows.map((row) => {
    const allowed = row.policy.allow?.length
      ? row.policy.allow.map(labelOf).join(', ')
      : t('seal.accounts.policy.allAccounts', 'All accounts')
    const fallback = row.policy.default
      ? labelOf(row.policy.default)
      : t('seal.accounts.policy.noDefault', 'Best available')
    return (
      <SettingsRow
        key={`${row.scope}:${row.target}:${row.provider}`}
        label={
          <span className="flex items-center gap-2">
            <span className="truncate">{row.label}</span>
            <Badge variant="outline">
              {row.scope === 'project'
                ? t('seal.accounts.policy.project', 'Project')
                : t('seal.accounts.policy.machine', 'Machine')}
            </Badge>
            <Badge variant="secondary">
              {row.provider === 'claude'
                ? t('seal.accounts.provider.claude', 'Claude')
                : t('seal.accounts.provider.codex', 'Codex')}
            </Badge>
          </span>
        }
        description={t(
          'seal.accounts.policy.summary',
          'Allowed: {{value0}} · Default: {{value1}}',
          {
            value0: allowed,
            value1: fallback
          }
        )}
        control={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('seal.accounts.policy.remove', 'Remove rule')}
            onClick={() => onRemove(row)}
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
    )
  })
}
