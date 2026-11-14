import React from 'react'
import { ChevronDown, Code } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { openOpenInAppsSettings } from '@/components/sidebar/workspace-actions/open/WorktreeOpenInMenu'
import { OpenInApplicationIcon } from '@/lib/files/os-open/open-in-app-catalog'
import { NO_OPEN_IN_APPLICATIONS } from '@/lib/files/os-open/open-in-application-selection'
import { useAppStore } from '@/store'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { isRemoteSshEditorCommand } from '../../../../../shared/remote-ssh-editor-launcher'
import { openMachineInEditor, type MachineEditorOpenHandlers } from './machine-quick-actions'

/** Opens the machine's home folder in the first Open-in app that can reach it; the menu picks another. */
export function MachineOpenInEditorButton({
  machine,
  homeDir,
  onAddSshDetails
}: {
  machine: MachineSummary
  homeDir: string | null
} & MachineEditorOpenHandlers): React.JSX.Element {
  const t = useTranslate()
  const applications = useAppStore((s) => s.settings?.openInApplications ?? NO_OPEN_IN_APPLICATIONS)
  const remote = machine.connection !== 'local'
  const canOpen = (command: string): boolean => !remote || isRemoteSshEditorCommand(command)
  const preferred =
    applications.find((application) => canOpen(application.command)) ?? applications[0] ?? null
  const blocked =
    machine.status !== 'online'
      ? t(
          'auto.components.machines.detail.editorOffline',
          'Connect this machine to open it in an editor.'
        )
      : !homeDir
        ? t(
            'auto.components.machines.detail.editorNoHome',
            'Waiting for this machine to report its home folder.'
          )
        : null
  const open = (application: (typeof applications)[number] | null): void => {
    if (homeDir) {
      void openMachineInEditor(machine, homeDir, application, { onAddSshDetails })
    }
  }

  return (
    // Disabled buttons ignore pointer events; the wrapper carries the explanation.
    <span title={blocked ?? undefined}>
      <ButtonGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked !== null}
          data-machine-open-editor={preferred?.id ?? ''}
          onClick={() => open(preferred)}
        >
          {preferred ? <OpenInApplicationIcon application={preferred} size={14} /> : <Code />}
          <span className="hidden sm:inline">
            {preferred
              ? t('auto.components.machines.detail.editorOpenIn', 'Open in {{app}}', {
                  app: preferred.label
                })
              : t('auto.components.machines.detail.editor', 'Open in editor')}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('auto.components.machines.detail.editorChoose', 'Choose editor')}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {applications.map((application) => (
              <DropdownMenuItem
                key={application.id}
                disabled={blocked !== null || !canOpen(application.command)}
                onSelect={() => open(application)}
              >
                <OpenInApplicationIcon application={application} size={14} />
                <span className="min-w-0 truncate">{application.label}</span>
                {canOpen(application.command) ? null : (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {t('auto.components.sidebar.WorktreeOpenInMenu.localOnly', 'Local only')}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {applications.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={openOpenInAppsSettings}>
              {t('auto.components.sidebar.WorktreeOpenInMenu.1417fd8380', 'Customize apps...')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </span>
  )
}
