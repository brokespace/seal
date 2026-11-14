import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SessionSummariesStatus } from '../../../../shared/session-summaries/session-summary-contracts'

const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }
const RECHECK_MS = 5 * 60_000

function useSummariesPausedUntil(): number | null {
  const [pausedUntil, setPausedUntil] = useState<number | null>(null)
  useEffect(() => {
    let disposed = false
    const run = (): void => {
      callRuntimeRpc<SessionSummariesStatus>(LOCAL_TARGET, 'sessionSummaries.status', undefined, {
        suppressFeatureInteraction: true
      }).then(
        (status) => {
          if (!disposed) {
            const until = status.enabled && status.configured ? status.pausedUntil : null
            // The next recheck drops a pause that has run out.
            setPausedUntil(until !== null && until > Date.now() ? until : null)
          }
        },
        () => {}
      )
    }
    run()
    const stop = installWindowVisibilityInterval({
      run,
      intervalMs: RECHECK_MS,
      slowWhileUnfocused: true
    })
    return () => {
      disposed = true
      stop()
    }
  }, [])
  return pausedUntil
}

/** Says, quietly, that new summaries wait for the provider's limit to reset; nothing when they run. */
export function SessionSummariesPausedNote(): React.JSX.Element | null {
  const t = useTranslate()
  const pausedUntil = useSummariesPausedUntil()
  if (pausedUntil === null) {
    return null
  }
  const time = new Date(pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-2xs text-muted-foreground">
          {t('seal.sessionSummaries.paused', 'Summaries paused')}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {t(
          'seal.sessionSummaries.pausedDetail',
          'Cloudflare’s free limit for today is used up. New summaries resume at {{time}}.',
          { time }
        )}
      </TooltipContent>
    </Tooltip>
  )
}
