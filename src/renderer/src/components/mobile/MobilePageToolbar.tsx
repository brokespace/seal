import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { PageHeader } from '@/components/page-layout/PageLayout'

type MobilePageToolbarProps = {
  showMobileButton: boolean
  onClose: () => void
  onToggleMobileSidebarButton: () => void
}

export function MobilePageToolbar({
  showMobileButton,
  onClose,
  onToggleMobileSidebarButton
}: MobilePageToolbarProps): React.JSX.Element {
  const t = useTranslate()
  const sidebarToggleLabel = showMobileButton
    ? t('auto.components.mobile.MobilePageToolbar.c669abcf8f', 'Hide from sidebar')
    : t('auto.components.mobile.MobilePageToolbar.fb5f28330e', 'Show in sidebar')
  const sidebarToggleTooltip = showMobileButton
    ? t('auto.components.mobile.MobilePageToolbar.e1c7b4a92d', 'Configure in Settings > Mobile.')
    : t(
        'auto.components.mobile.MobilePageToolbar.f3d8e5b71a',
        'Adds the shortcut back to the sidebar.'
      )

  return (
    <PageHeader title={t('auto.components.sidebar.SidebarNav.1b5c41caee', 'Orca Mobile')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={showMobileButton ? 'outline' : 'secondary'}
            size="sm"
            onClick={onToggleMobileSidebarButton}
            aria-label={sidebarToggleLabel}
          >
            {sidebarToggleLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {sidebarToggleTooltip}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full"
            onClick={onClose}
            aria-label={t(
              'auto.components.mobile.MobilePageToolbar.9883b58693',
              'Close Orca Mobile'
            )}
          >
            <X className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {t('auto.components.mobile.MobilePageToolbar.ad2284a9e2', 'Close · Esc')}
        </TooltipContent>
      </Tooltip>
    </PageHeader>
  )
}
