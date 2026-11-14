import React from 'react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'

export function NewWorkspaceComposerHeader({
  agentSession,
  folderWorkspace,
  createActionLabel
}: {
  agentSession: boolean
  folderWorkspace: boolean
  createActionLabel: string
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <DialogHeader className="gap-1">
      <DialogTitle className="text-base font-semibold">
        {agentSession
          ? t('components.newAgentSession.title', 'New agent session')
          : folderWorkspace
            ? t(
                'auto.components.sidebar.FolderWorkspaceComposerDialog.title',
                'Create Folder Workspace'
              )
            : createActionLabel}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {agentSession
          ? t(
              'components.newAgentSession.description',
              'Choose the agent, account and machine. Turn on Create worktree to start it in a new worktree.'
            )
          : t(
              'components.newWorkspace.createDescription',
              'Choose the project and workspace name. Select an agent if you want to start one.'
            )}
      </DialogDescription>
    </DialogHeader>
  )
}
