import type React from 'react'
import { useTranslate } from '@/i18n/use-translate'

/** Divides Seal's swappable accounts from the per-host usage setup of every other provider. */
export function OtherProviderAccountsHeader({
  hostPicker
}: {
  hostPicker: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      data-slot="seal-other-providers"
      className="flex items-end justify-between gap-4 border-t border-border/60 pt-8"
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold leading-tight">
          {t('seal.accounts.otherProviders.title', 'Other providers')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'seal.accounts.otherProviders.description',
            'Usage and sign-in setup for agents Seal does not swap accounts for. These settings belong to one machine at a time.'
          )}
        </p>
      </div>
      {hostPicker ? <div className="shrink-0">{hostPicker}</div> : null}
    </div>
  )
}
