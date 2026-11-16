import React, { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineServiceManagerChoice } from '../../../../../shared/machines/machine-view'

export type MachineServerInstallChoice = {
  install: boolean
  manager: MachineServiceManagerChoice
}

export const DEFAULT_SERVER_INSTALL_CHOICE: MachineServerInstallChoice = {
  install: true,
  manager: 'auto'
}

function ManagerOption({
  value,
  label,
  help
}: {
  value: MachineServiceManagerChoice
  label: string
  help: string
}): React.JSX.Element {
  const id = useId()
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs">
      <RadioGroupItem
        value={value}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
      />
      <span>
        <span id={`${id}-label`} className="block font-medium">
          {label}
        </span>
        <span id={`${id}-help`} className="text-muted-foreground">
          {help}
        </span>
      </span>
    </label>
  )
}

type ChoiceProps = {
  choice: MachineServerInstallChoice
  onChange: (choice: MachineServerInstallChoice) => void
}

/** Whether a new SSH machine gets Seal's server. */
export function AddMachineServerInstallOptions({
  choice,
  onChange
}: ChoiceProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <label className="flex items-start gap-2 text-xs" data-add-machine-server-install>
      <Checkbox
        checked={choice.install}
        onCheckedChange={(checked) => onChange({ ...choice, install: checked === true })}
      />
      <span>
        <span className="block font-medium">
          {t('w7.add.install', 'Install Seal server on this machine (recommended)')}
        </span>
        <span className="text-muted-foreground">
          {t(
            'w7.add.installHelp',
            'Keeps agents running when this computer disconnects, and enables chat, sessions and file features on the machine.'
          )}
        </span>
      </span>
    </label>
  )
}

/** How the installed server is kept running; sits with the SSH form's other advanced options. */
export function AddMachineServiceManagerOptions({
  choice,
  onChange
}: ChoiceProps): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  return (
    <div className="space-y-2 py-1 text-xs" data-add-machine-service-manager>
      <p id={labelId} className="font-medium">
        {t('w7.add.manager', 'How Seal server is kept running')}
      </p>
      <RadioGroup
        aria-labelledby={labelId}
        value={choice.manager}
        onValueChange={(manager) =>
          onChange({ ...choice, manager: manager === 'pm2' ? 'pm2' : 'auto' })
        }
      >
        <ManagerOption
          value="auto"
          label={t('w7.add.managerAuto', 'Automatic (recommended)')}
          help={t(
            'w7.add.managerAutoHelp',
            'The system’s own service manager; PM2 when that is not available.'
          )}
        />
        <ManagerOption
          value="pm2"
          label={t('w7.add.managerPm2', 'PM2')}
          help={t('w7.add.managerPm2Help', 'Use PM2 when it is installed on the machine.')}
        />
      </RadioGroup>
    </div>
  )
}
