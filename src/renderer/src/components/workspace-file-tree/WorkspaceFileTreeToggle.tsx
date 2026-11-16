import { Files } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { workspaceFileTreeStore } from './workspace-file-tree-store'

export function WorkspaceFileTreeToggle({
  worktreeId,
  open
}: {
  worktreeId: string
  open: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const label = open ? t('seal.fileTree.hide', 'Hide files') : t('seal.fileTree.show', 'Show files')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          data-workspace-file-tree-toggle={worktreeId}
          aria-label={label}
          aria-expanded={open}
          onClick={() => workspaceFileTreeStore.toggle(worktreeId)}
        >
          <Files className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
