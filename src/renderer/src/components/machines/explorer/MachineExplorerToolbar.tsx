import React from 'react'
import { ArrowUp, Eye, EyeOff, FolderPlus, Globe, House, RefreshCw, Upload } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { machinePathDirname } from '../../../../../shared/machines/machine-paths'
import { MachinePathCrumbs } from './MachinePathCrumbs'
import type { MachineFileActions } from './use-machine-file-actions'

function ToolbarButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MachineExplorerToolbar({
  root,
  isRemote,
  showHidden,
  onToggleHidden,
  navigate,
  refresh,
  actions
}: {
  root: string | null
  isRemote: boolean
  showHidden: boolean
  onToggleHidden: () => void
  navigate: (path: string | null) => void
  refresh: () => void
  actions: MachineFileActions
}): React.JSX.Element {
  const t = useTranslate()
  const parent = root ? machinePathDirname(root) : null
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1">
      <ToolbarButton
        label={t('auto.components.machines.explorer.home', 'Home folder')}
        onClick={() => navigate(null)}
      >
        <House />
      </ToolbarButton>
      <ToolbarButton
        label={t('auto.components.machines.explorer.up', 'Parent folder')}
        disabled={!parent}
        onClick={() => parent && navigate(parent)}
      >
        <ArrowUp />
      </ToolbarButton>
      <MachinePathCrumbs
        path={root}
        label={t('auto.components.machines.explorer.path', 'Current folder')}
        onOpen={navigate}
      />
      <ToolbarButton
        label={t('auto.components.machines.explorer.refresh', 'Refresh')}
        onClick={() => refresh()}
      >
        <RefreshCw />
      </ToolbarButton>
      <ToolbarButton
        label={
          showHidden
            ? t('auto.components.machines.explorer.hideHidden', 'Hide hidden files')
            : t('auto.components.machines.explorer.showHidden', 'Show hidden files')
        }
        onClick={onToggleHidden}
      >
        {showHidden ? <Eye /> : <EyeOff />}
      </ToolbarButton>
      {root ? (
        <>
          <ToolbarButton
            label={t('auto.components.machines.explorer.newFolder', 'New folder')}
            onClick={() => actions.newFolder(root)}
          >
            <FolderPlus />
          </ToolbarButton>
          <ToolbarButton
            label={t('auto.components.machines.explorer.upload', 'Upload files')}
            onClick={() => actions.pickAndUpload(root)}
          >
            <Upload />
          </ToolbarButton>
          {isRemote ? (
            <ToolbarButton
              label={t('auto.components.machines.explorer.downloadUrl', 'Download from URL')}
              onClick={() => actions.downloadUrl(root)}
            >
              <Globe />
            </ToolbarButton>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
