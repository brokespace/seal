import { useTranslate } from '@/i18n/use-translate'
import type { Translate } from '@/i18n/use-translate'
import { SettingsBadge } from '../../form-controls/SettingsFormControls'
import {
  APPLIES_TO_ALL,
  type AppliesTo,
  type ProjectOverride
} from '../../../../../../shared/seal-connectors/seal-connectors-types'
import { appliesToIsAll } from '../../../../../../shared/seal-connectors/seal-connectors-scope'
import { appliesToLabel, type AppliesToOptions } from './use-applies-to-options'

type Scoped = { appliesTo: AppliesTo; projectOverrides?: readonly ProjectOverride[] }

function names(
  list: readonly string[],
  options: readonly { id: string; label: string }[],
  max: number
): string {
  const labels = list.map((id) => appliesToLabel(options, id))
  return labels.length <= max
    ? labels.join(', ')
    : `${labels.slice(0, max).join(', ')} +${labels.length - max}`
}

/** "All agents", or what is narrowed: "2 machines · Claude, Codex". */
export function appliesToSummary(
  value: Scoped,
  options: AppliesToOptions | null,
  t: Translate
): string {
  const { appliesTo } = value
  const parts: string[] = []
  if (appliesTo.machines !== 'all') {
    parts.push(
      appliesTo.machines.length === 1 && options
        ? appliesToLabel(options.machines, appliesTo.machines[0])
        : t('seal.connectors.appliesTo.machineCount', '{{count}} machines', {
            count: appliesTo.machines.length
          })
    )
  }
  if (appliesTo.accounts !== 'all') {
    parts.push(
      appliesTo.accounts.length === 1 && options
        ? appliesToLabel(options.accounts, appliesTo.accounts[0])
        : t('seal.connectors.appliesTo.accountCount', '{{count}} accounts', {
            count: appliesTo.accounts.length
          })
    )
  }
  if (appliesTo.harnesses !== 'all') {
    parts.push(
      options
        ? names(appliesTo.harnesses, options.harnesses, 2)
        : t('seal.connectors.appliesTo.harnessCount', '{{count}} agents', {
            count: appliesTo.harnesses.length
          })
    )
  }
  const overrides = value.projectOverrides?.length ?? 0
  if (overrides > 0) {
    parts.push(
      t('seal.connectors.appliesTo.overrideCount', '{{count}} project rules', { count: overrides })
    )
  }
  return parts.length > 0
    ? parts.join(' · ')
    : t('seal.connectors.appliesTo.allAgents', 'All agents')
}

const EVERYWHERE: Scoped = { appliesTo: APPLIES_TO_ALL }

export function AppliesToChip({
  value = EVERYWHERE,
  options = null
}: {
  value?: Scoped
  options?: AppliesToOptions | null
}): React.JSX.Element {
  const t = useTranslate()
  const everywhere = appliesToIsAll(value.appliesTo) && !value.projectOverrides?.length
  return (
    <SettingsBadge tone={everywhere ? 'muted' : 'neutral'} className="max-w-64 truncate">
      <span className="truncate" data-applies-to-chip="">
        {appliesToSummary(value, options, t)}
      </span>
    </SettingsBadge>
  )
}
