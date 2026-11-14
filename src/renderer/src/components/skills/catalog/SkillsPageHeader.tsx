import { Download, History, Link2, MoreHorizontal, Share2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { skillCountLabel } from '../presentation/skill-display-labels'
import { PageHeader, PageTitle } from '@/components/page-layout/PageLayout'
import { SkillsSourcesPopover } from './SkillsSourcesPopover'
import type { SkillSourceInventoryEntry } from './skill-source-inventory'

export function SkillsPageHeader({
  skillCount,
  sourceEntries,
  scannedSourceCount,
  hostLabel,
  onClose,
  onStartShare,
  deleteSupported,
  deleteUnsupportedReason,
  onStartDelete,
  onInstallFromLink,
  onManageInstalls,
  onOpenSharedLinks
}: {
  skillCount: number
  sourceEntries: readonly SkillSourceInventoryEntry[]
  scannedSourceCount: number
  hostLabel: string | null
  onClose: () => void
  onStartShare: () => void
  /** Disable deletion with a reason until the target and host capability are known. */
  deleteSupported: boolean
  deleteUnsupportedReason: string | null
  onStartDelete: () => void
  onInstallFromLink: () => void
  onManageInstalls: () => void
  onOpenSharedLinks: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <PageHeader
      className="border-b border-border"
      title={
        <>
          <PageTitle className="flex-none">
            {t('auto.components.skills.SkillsPage.f43ad6edf3', 'Skills')}
          </PageTitle>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">{skillCountLabel(skillCount, t)}</span>
            {sourceEntries.length > 0 ? (
              <>
                <span aria-hidden>·</span>
                <SkillsSourcesPopover entries={sourceEntries} scannedCount={scannedSourceCount} />
              </>
            ) : null}
            {hostLabel ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{hostLabel}</span>
              </>
            ) : null}
          </div>
        </>
      }
    >
      <Button type="button" size="sm" onClick={onStartShare}>
        <Share2 className="size-3.5" />
        {t('auto.components.skills.SkillShareSelectionControls.01c5a15e02', 'Share skills')}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onInstallFromLink}>
        <Download className="size-3.5" />
        {t('auto.components.skills.SkillsPage.aee7b99cc6', 'Install from link')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('auto.components.skills.SkillsPage.moreActions', 'More actions')}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onManageInstalls}>
            <History />
            {t('auto.components.skills.SkillsPage.c13b82793c', 'Manage installs')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenSharedLinks}>
            <Link2 />
            {t('auto.components.skills.SkillsPage.sharedLinks', 'Shared links')}
          </DropdownMenuItem>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="pointer-events-auto block">
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!deleteSupported}
                  onSelect={onStartDelete}
                >
                  <Trash2 />
                  {t('auto.components.skills.SkillsPage.deleteSkills', 'Delete skills…')}
                </DropdownMenuItem>
              </span>
            </TooltipTrigger>
            {deleteSupported || !deleteUnsupportedReason ? null : (
              <TooltipContent side="left" sideOffset={4}>
                {deleteUnsupportedReason}
              </TooltipContent>
            )}
          </Tooltip>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full"
            onClick={onClose}
            aria-label={t('auto.components.skills.SkillsPage.closeSkills', 'Close skills')}
          >
            <X className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {t('auto.components.skills.SkillsPage.closeTooltip', 'Close · Esc')}
        </TooltipContent>
      </Tooltip>
    </PageHeader>
  )
}
