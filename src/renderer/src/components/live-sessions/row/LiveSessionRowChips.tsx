import React from 'react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'

const CHIP = 'shrink-0 truncate rounded-sm border px-1 leading-[14px]'

/** What a session runs on and as: its model, its machine and its account. */
export function LiveSessionRowChips(props: {
  session: LiveSession
  machine?: string | null
  account: string | null
  /** The border of the surface the row sits on. */
  borderClassName: string
}): React.JSX.Element {
  const t = useTranslate()
  const showModel = useAppStore((state) => state.showAgentModels !== false)
  const model = showModel ? props.session.model?.trim() : null
  return (
    <>
      {model ? (
        <span
          data-live-session-model
          className={cn('max-w-24', CHIP, props.borderClassName)}
          title={model}
        >
          {model}
        </span>
      ) : null}
      {props.machine ? (
        <span
          data-live-session-machine
          className={cn('max-w-20', CHIP, props.borderClassName)}
          title={t('auto.components.live-sessions.sessionRows.machine', 'Machine')}
        >
          {props.machine}
        </span>
      ) : null}
      {props.account ? (
        <span
          data-live-session-account
          className={cn('max-w-16', CHIP, props.borderClassName)}
          title={t('auto.components.live-sessions.sidebar.account', 'Account')}
        >
          {props.account}
        </span>
      ) : null}
    </>
  )
}
