import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { useMachineViews } from '../model/use-machines-inventory'

/** How many machines still show the one-time install offer; gone once each has a decision. */
export function SealServerOfferCount(): React.JSX.Element | null {
  const t = useTranslate()
  const { views } = useMachineViews()
  const offered = views.filter((view) => view.serverInstallAction === 'offer')
  if (offered.length === 0) {
    return null
  }
  const label =
    offered.length === 1
      ? t('w7.sidebar.offerOne', 'Seal server can be installed on {{name}}', {
          name: offered[0]?.name
        })
      : t('w7.sidebar.offerMany', 'Seal server can be installed on {{count}} machines', {
          count: offered.length
        })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-seal-server-offers={offered.length}
          className="shrink-0 rounded-full bg-primary px-1.5 py-px text-3xs font-semibold text-primary-foreground tabular-nums"
        >
          <span aria-hidden="true">{offered.length}</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
