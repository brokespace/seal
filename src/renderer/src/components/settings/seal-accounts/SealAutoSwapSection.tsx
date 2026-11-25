import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type {
  SealAutoSwapSettings,
  SealProvider
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { SealAutoSwapRows } from './SealAutoSwapRows'

type SealAutoSwapSectionProps = {
  status: SealAccountsStatus
  onChange: (provider: SealProvider, patch: Partial<SealAutoSwapSettings>) => void
  onEvaluateNow: (provider: SealProvider) => void
}

/** When Seal moves work to another account, set per provider. */
export function SealAutoSwapSection({
  status,
  onChange,
  onEvaluateNow
}: SealAutoSwapSectionProps): React.JSX.Element {
  const t = useTranslate()
  const [provider, setProvider] = useState<SealProvider>('claude')
  const state = (entry: SealProvider): string => {
    const settings = status.config.autoSwap[entry]
    return settings.enabled || settings.liveSessionSwap !== false
      ? t('seal.accounts.autoSwap.stateOn', 'on')
      : t('seal.accounts.autoSwap.stateOff', 'off')
  }
  return (
    <SettingsGroup
      id="seal-accounts-auto-swap"
      title={t('seal.accounts.autoSwap.title', 'Auto-swap')}
      description={t(
        'seal.accounts.autoSwap.description',
        'Seal reads every account’s 5-hour and 7-day usage and moves work to the next account in the list before a limit is hit. Each provider has its own settings.'
      )}
      action={
        <SettingsSegmentedControl
          size="sm"
          value={provider}
          onChange={setProvider}
          ariaLabel={t('seal.accounts.autoSwap.provider', 'Provider')}
          options={[
            {
              value: 'claude',
              label: t('seal.accounts.autoSwap.tab', '{{value0}} · {{value1}}', {
                value0: t('seal.accounts.group.claude', 'Claude'),
                value1: state('claude')
              })
            },
            {
              value: 'codex',
              label: t('seal.accounts.autoSwap.tab', '{{value0}} · {{value1}}', {
                value0: t('seal.accounts.group.codex', 'Codex'),
                value1: state('codex')
              })
            }
          ]}
        />
      }
    >
      <SealAutoSwapRows
        key={provider}
        settings={status.config.autoSwap[provider]}
        lastDecision={status.providers[provider].lastDecision}
        onChange={(patch) => onChange(provider, patch)}
        onEvaluateNow={() => onEvaluateNow(provider)}
      />
    </SettingsGroup>
  )
}
