import React from 'react'
import { ChevronDown, Code, FileCode, KeyRound } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { OpenInApplicationIcon } from '@/lib/files/os-open/open-in-app-catalog'
import { NO_OPEN_IN_APPLICATIONS } from '@/lib/files/os-open/open-in-application-selection'
import { openOpenInAppsSettings } from '@/components/sidebar/workspace-actions/open/WorktreeOpenInMenu'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { listMachineEditorApplications, planMachineEditorOpen } from './machine-editor-plan'

/** `applicationId` picks one of the user's Open In apps; `'seal'` is Seal's own editor. */
export type MachineEditorChoice = { applicationId?: string } | 'seal'

/** Opens the folder the file browser shows; the chevron picks which editor. */
export function MachineEditorButton({
  machine,
  disabled,
  onOpen,
  onAddSshDetails
}: {
  machine: MachineSummary
  disabled: boolean
  onOpen: (choice: MachineEditorChoice) => void
  onAddSshDetails: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const applications = useAppStore((s) => s.settings?.openInApplications ?? NO_OPEN_IN_APPLICATIONS)
  const usable = listMachineEditorApplications(machine, applications)
  const plan = planMachineEditorOpen(machine, applications)
  const isRemote = machine.connection !== 'local'
  const needsSshDetails = isRemote && !machine.sshTargetId

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        title={
          plan.kind === 'external'
            ? t('auto.components.machines.editor.openInApp', 'Open in {{app}}', {
                app: plan.application.label
              })
            : t('auto.components.machines.editor.openInSealEditor', 'Open in Seal’s editor')
        }
        onClick={() => onOpen({})}
      >
        <Code />
        <span className="hidden sm:inline">
          {t('auto.components.machines.detail.editor', 'Open in editor')}
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={disabled}
            aria-label={t('auto.components.machines.editor.choose', 'Choose editor')}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {usable.map((application) => (
            <DropdownMenuItem
              key={application.id}
              onSelect={() => onOpen({ applicationId: application.id })}
            >
              <OpenInApplicationIcon application={application} size={14} />
              <span className="min-w-0 truncate">{application.label}</span>
              {isRemote ? (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {t('auto.components.sidebar.WorktreeOpenInMenu.remoteSsh', 'Remote SSH')}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => onOpen('seal')}>
            <FileCode />
            {t('auto.components.machines.editor.sealEditor', 'Seal’s editor')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {needsSshDetails ? (
            <DropdownMenuItem onSelect={onAddSshDetails}>
              <KeyRound />
              {t('auto.components.machines.editor.addSshDetails', 'Add SSH details…')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={openOpenInAppsSettings}>
            {t('auto.components.machines.editor.customizeApps', 'Choose apps…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
