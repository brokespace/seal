import { useTranslate } from '@/i18n/use-translate'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSwitchRow
} from '../form-controls/SettingsFormControls'
import { SettingsGroupNestedRows } from '../section-layout/SettingsGroup'
import { Button } from '../../ui/button'
import type {
  SealAutoSwapSettings,
  SealSwapStrategy
} from '../../../../../shared/seal-accounts/seal-accounts-config'

type SealAutoSwapRowsProps = {
  settings: SealAutoSwapSettings
  lastDecision: { at: number; summary: string } | null
  onChange: (patch: Partial<SealAutoSwapSettings>) => void
  onEvaluateNow: () => void
}

/** One provider's auto-swap switch plus the thresholds and safety knobs it runs with. */
export function SealAutoSwapRows({
  settings,
  lastDecision,
  onChange,
  onEvaluateNow
}: SealAutoSwapRowsProps) {
  const t = useTranslate()
  const strategies: { value: SealSwapStrategy; label: string }[] = [
    { value: 'best', label: t('seal.accounts.strategy.best', 'Most headroom') },
    { value: 'weekly-first', label: t('seal.accounts.strategy.weeklyFirst', 'Save weekly') },
    { value: 'consume-first', label: t('seal.accounts.strategy.consumeFirst', 'Use it up') },
    { value: 'priority', label: t('seal.accounts.strategy.priority', 'Priority') }
  ]
  const liveSessions = settings.liveSessionSwap !== false
  return (
    <>
      <SettingsSwitchRow
        label={t('seal.accounts.autoSwap.liveSessions', 'Move running sessions')}
        description={t(
          'seal.accounts.autoSwap.liveSessionsDescription',
          'Seal polls every account’s 5-hour and weekly usage and moves a running agent to another account before it crosses a limit below, or right away if its login dies. It resumes the conversation when it cannot switch live.'
        )}
        checked={liveSessions}
        onChange={() => onChange({ liveSessionSwap: !liveSessions })}
      />
      <SettingsSwitchRow
        label={t('seal.accounts.autoSwap.enabled', 'Auto-swap new sessions')}
        description={t(
          'seal.accounts.autoSwap.enabledDescription',
          'Also switch the account new sessions start on, using the same limits.'
        )}
        checked={settings.enabled}
        onChange={() => onChange({ enabled: !settings.enabled })}
      />
      {settings.enabled || liveSessions ? (
        <SettingsGroupNestedRows>
          <SettingsRow
            label={t('seal.accounts.autoSwap.strategy', 'Strategy')}
            control={
              <SettingsSegmentedControl
                size="sm"
                value={settings.strategy}
                onChange={(strategy) => onChange({ strategy })}
                options={strategies}
                ariaLabel={t('seal.accounts.autoSwap.strategy', 'Strategy')}
              />
            }
          />
          <NumberField
            label={t('seal.accounts.autoSwap.sessionThreshold', '5h limit')}
            description={t(
              'seal.accounts.autoSwap.sessionThresholdDescription',
              'Swap away once the 5-hour window reaches this. 90% matches claude-swap.'
            )}
            value={settings.sessionThreshold}
            min={1}
            max={100}
            integer
            suffix="%"
            onChange={(sessionThreshold) => onChange({ sessionThreshold })}
          />
          <NumberField
            label={t('seal.accounts.autoSwap.weeklyThreshold', '7d limit')}
            description={t(
              'seal.accounts.autoSwap.weeklyThresholdDescription',
              'Swap away once the weekly (or a per-model weekly) window reaches this.'
            )}
            value={settings.weeklyThreshold}
            min={1}
            max={100}
            integer
            suffix="%"
            onChange={(weeklyThreshold) => onChange({ weeklyThreshold })}
          />
          <NumberField
            label={t('seal.accounts.autoSwap.hysteresis', 'Headroom margin')}
            description={t(
              'seal.accounts.autoSwap.hysteresisDescription',
              'A swap target needs this many more points of headroom than the current account, and must be under its own limits, so swaps never bounce.'
            )}
            value={settings.hysteresis}
            min={0}
            max={50}
            integer
            suffix="%"
            onChange={(hysteresis) => onChange({ hysteresis })}
          />
          <NumberField
            label={t('seal.accounts.autoSwap.cooldown', 'Cooldown')}
            description={t(
              'seal.accounts.autoSwap.cooldownDescription',
              'Minimum time between swaps before a limit. A full window or dead login skips it.'
            )}
            value={settings.cooldownMinutes}
            min={0}
            max={1440}
            integer
            suffix={t('seal.accounts.minutes', 'min')}
            onChange={(cooldownMinutes) => onChange({ cooldownMinutes })}
          />
          <SettingsSwitchRow
            label={t('seal.accounts.autoSwap.failover', 'Fail over on dead logins')}
            description={t(
              'seal.accounts.autoSwap.failoverDescription',
              'Swap immediately when the current login expires or is revoked, and pause that account.'
            )}
            checked={settings.failoverOnAuthError}
            onChange={() => onChange({ failoverOnAuthError: !settings.failoverOnAuthError })}
          />
          <SettingsSwitchRow
            label={t('seal.accounts.autoSwap.modelLimits', 'Count per-model limits')}
            description={t(
              'seal.accounts.autoSwap.modelLimitsDescription',
              'Treat a model-specific weekly cap like the weekly limit.'
            )}
            checked={settings.respectModelLimits}
            onChange={() => onChange({ respectModelLimits: !settings.respectModelLimits })}
          />
          <SettingsSwitchRow
            label={t('seal.accounts.autoSwap.apiKeyFallback', 'Fall back to API keys')}
            description={t(
              'seal.accounts.autoSwap.apiKeyFallbackDescription',
              'Launch on a pay-as-you-go key when every subscription is exhausted.'
            )}
            checked={settings.apiKeyFallback}
            onChange={() => onChange({ apiKeyFallback: !settings.apiKeyFallback })}
          />
          <SettingsSwitchRow
            label={t(
              'seal.accounts.autoSwap.rateLimitFallback',
              'Fallback: react to limit messages'
            )}
            description={t(
              'seal.accounts.autoSwap.rateLimitFallbackDescription',
              'Last resort only. If an agent stops with a usage-limit message that polling has not caught yet, move it anyway.'
            )}
            checked={settings.rateLimitFallback !== false}
            onChange={() => onChange({ rateLimitFallback: settings.rateLimitFallback === false })}
          />
          <SettingsRow
            label={t('seal.accounts.autoSwap.lastDecision', 'Last check')}
            description={
              lastDecision?.summary ?? t('seal.accounts.autoSwap.noDecision', 'Not run yet')
            }
            control={
              <Button variant="outline" size="xs" onClick={onEvaluateNow}>
                {t('seal.accounts.autoSwap.evaluate', 'Check now')}
              </Button>
            }
          />
        </SettingsGroupNestedRows>
      ) : null}
    </>
  )
}
