import { Loader2, ShieldCheck } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { utilityModelProvider } from '../../../../../../shared/utility-model/utility-model-provider-catalog'
import type {
  UtilityModelProviderId,
  UtilityModelTestResult
} from '../../../../../../shared/utility-model/utility-model-types'
import { Button } from '../../../ui/button'
import { utilityModelFailureText } from './utility-model-failure-text'

export function utilityModelResumeTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function UtilityModelTestResultLine({
  provider,
  result
}: {
  provider: UtilityModelProviderId
  result: UtilityModelTestResult
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <p
      role="status"
      className={cn('text-xs', result.ok ? 'text-muted-foreground' : 'text-destructive')}
    >
      {result.ok
        ? result.usedFallback
          ? t(
              'seal.cloudflareAi.test.okFallback',
              'Works: the fallback {{model}} answered in {{ms}} ms.',
              { model: result.model, ms: result.elapsedMs }
            )
          : t('seal.cloudflareAi.test.ok', 'Works: {{model}} answered in {{ms}} ms.', {
              model: result.model,
              ms: result.elapsedMs
            })
        : utilityModelFailureText(result.failure, t, provider)}
    </p>
  )
}

/** A provider account's state at a glance, with a button that sends it one real request. */
export function UtilityModelAccountStatus({
  provider,
  configured,
  title,
  detail,
  pausedUntil,
  testResult,
  testing,
  canTest,
  onTest
}: {
  provider: UtilityModelProviderId
  configured: boolean
  /** Null while the host has not answered yet. */
  title: string | null
  detail: string | null
  pausedUntil: number | null
  testResult: UtilityModelTestResult | null
  testing: boolean
  canTest: boolean
  onTest: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex items-start gap-3 py-3">
      <ShieldCheck
        className={cn(
          'mt-0.5 size-4 shrink-0',
          configured ? 'text-foreground' : 'text-muted-foreground'
        )}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title ? <p className="text-xs font-medium">{title}</p> : null}
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        {pausedUntil ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'seal.utilityModel.status.paused',
              '{{provider}}’s limit was reached. Summaries and recaps on it resume at {{time}}; nothing else is affected.',
              {
                provider: utilityModelProvider(provider).label,
                time: utilityModelResumeTime(pausedUntil)
              }
            )}
          </p>
        ) : null}
        {testResult ? <UtilityModelTestResultLine provider={provider} result={testResult} /> : null}
      </div>
      <Button
        variant="outline"
        size="xs"
        disabled={testing || !canTest}
        onClick={onTest}
        className="shrink-0"
      >
        {testing ? <Loader2 className="size-3 animate-spin" /> : null}
        {t('seal.cloudflareAi.test.button', 'Test')}
      </Button>
    </div>
  )
}
