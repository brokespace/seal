import { useTranslate } from '@/i18n/use-translate'
import { formatResetDuration } from '../../../../../shared/rate-limit-reset-format'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import type { SealAccountCandidate } from '../../../../../shared/seal-accounts/seal-account-candidates'
import type {
  SealAccountProfile,
  SealAutoSwapSettings
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealQuarantineEntry } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { SealAccountProfileEditor } from './SealAccountProfileEditor'
import { SealUsageMeter } from './SealUsageMeter'

type SealAccountRowProps = {
  candidate: SealAccountCandidate
  profile: SealAccountProfile | undefined
  settings: SealAutoSwapSettings
  quarantine: SealQuarantineEntry | undefined
  isMachineDefault: boolean
  now: number
  onUse: () => void
  onSaveProfile: (profile: SealAccountProfile) => Promise<boolean>
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function SealAccountRow({
  candidate,
  profile,
  settings,
  quarantine,
  isMachineDefault,
  now,
  onUse,
  onSaveProfile
}: SealAccountRowProps) {
  const t = useTranslate()
  const usage = candidate.usage
  const sessionThreshold = candidate.sessionThreshold ?? settings.sessionThreshold
  const weeklyThreshold = candidate.weeklyThreshold ?? settings.weeklyThreshold
  const paused = quarantine && quarantine.until > now ? quarantine : null
  const canUse =
    candidate.launchable &&
    !candidate.active &&
    !candidate.authFailure &&
    candidate.kind !== 'api-key'

  return (
    <div className="flex flex-col gap-2 py-3" data-settings-row="">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{candidate.label}</span>
          {candidate.email && candidate.email !== candidate.label ? (
            <span className="truncate text-xs text-muted-foreground">{candidate.email}</span>
          ) : null}
          {candidate.plan ? <Badge variant="outline">{candidate.plan}</Badge> : null}
          {candidate.kind === 'api-key' ? (
            <Badge variant="outline">{t('seal.accounts.badge.apiKey', 'API key')}</Badge>
          ) : null}
          {candidate.active ? (
            <Badge variant="secondary">{t('seal.accounts.badge.active', 'Next launch')}</Badge>
          ) : null}
          {isMachineDefault ? (
            <Badge variant="outline">{t('seal.accounts.badge.default', 'Machine default')}</Badge>
          ) : null}
          {candidate.authFailure ? (
            <Badge variant="destructive">
              {t('seal.accounts.badge.loginExpired', 'Login expired')}
            </Badge>
          ) : null}
          {paused ? (
            <Badge variant="outline" title={paused.reason}>
              {t('seal.accounts.badge.paused', 'Paused until {{value0}}', {
                value0: formatClock(paused.until)
              })}
            </Badge>
          ) : null}
          {candidate.disabled ? (
            <Badge variant="outline">{t('seal.accounts.badge.manualOnly', 'Manual only')}</Badge>
          ) : null}
          {!candidate.launchable ? (
            <Badge variant="outline">
              {t('seal.accounts.badge.notHere', 'Not on this machine')}
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('seal.accounts.priorityShort', 'P{{value0}}', { value0: candidate.priority })}
          </span>
        </div>
        {canUse ? (
          <Button variant="outline" size="xs" onClick={onUse}>
            {t('seal.accounts.useNow', 'Use for new sessions')}
          </Button>
        ) : null}
        <SealAccountProfileEditor
          accountLabel={candidate.label}
          profile={profile}
          onSave={onSaveProfile}
        />
      </div>
      {candidate.kind === 'api-key' ? (
        <span className="text-xs text-muted-foreground">
          {t('seal.accounts.apiKeyUsage', 'Pay as you go; no plan limits')}
        </span>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          <SealUsageMeter
            label={t('seal.accounts.window.session', '5h')}
            window={usage?.session ?? null}
            threshold={sessionThreshold}
            now={now}
          />
          <SealUsageMeter
            label={t('seal.accounts.window.weekly', '7d')}
            window={usage?.weekly ?? null}
            threshold={weeklyThreshold}
            now={now}
          />
          {usage?.models.map((model) => (
            <SealUsageMeter
              key={model.name}
              label={model.name}
              window={model}
              threshold={weeklyThreshold}
              now={now}
            />
          ))}
        </div>
      )}
      {candidate.kind !== 'api-key' && (candidate.swapEstimate || candidate.nextPollAt) ? (
        <span className="text-xs text-muted-foreground" data-slot="seal-swap-estimate">
          {[
            candidate.swapEstimate
              ? candidate.swapEstimate.at <= now
                ? t('seal.accounts.estimate.now', 'Over its {{value0}} limit; swapping', {
                    value0: candidate.swapEstimate.window
                  })
                : t(
                    'seal.accounts.estimate.at',
                    'Next swap ~{{value0}} ({{value1}} reaches {{value2}}%)',
                    {
                      value0: formatResetDuration(candidate.swapEstimate.at - now),
                      value1: candidate.swapEstimate.window,
                      value2: candidate.swapEstimate.line
                    }
                  )
              : null,
            candidate.nextPollAt && candidate.nextPollAt > now
              ? t('seal.accounts.estimate.nextPoll', 'Usage read again in {{value0}}', {
                  value0: formatResetDuration(candidate.nextPollAt - now)
                })
              : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : null}
      {usage?.error && !candidate.authFailure ? (
        <span className="text-xs text-muted-foreground">{usage.error}</span>
      ) : null}
    </div>
  )
}
