import React, { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslate } from '@/i18n/use-translate'
import { MACHINE_SERVICE_MANAGERS } from '../../../../../shared/machines/machine-server-install'
import type { MachineServiceManagerChoice } from '../../../../../shared/machines/machine-view'

export type MachineServerInstallChoice = {
  install: boolean
  manager: MachineServiceManagerChoice
}

/** An offer, not a default: nothing is installed unless the box is ticked and the dialog confirmed. */
export const DEFAULT_SERVER_INSTALL_CHOICE: MachineServerInstallChoice = {
  install: false,
  manager: 'auto'
}

const MANAGER_CHOICES: readonly MachineServiceManagerChoice[] = [
  'auto',
  ...MACHINE_SERVICE_MANAGERS
]

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

/** Whether Seal offers its server for a new SSH machine once the machine is saved. */
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
          {t('seal.machineServer.add.install', 'Install Seal server on this machine')}
        </span>
        <span className="text-muted-foreground">
          {t(
            'seal.machineServer.add.installHelp',
            'Keeps agents running when this computer disconnects, and enables chat, sessions and file features on the machine. After you save, Seal shows what it writes on the machine and asks before installing.'
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
        {t('seal.machineServer.add.manager', 'How Seal server is kept running')}
      </p>
      <RadioGroup
        aria-labelledby={labelId}
        value={choice.manager}
        onValueChange={(value) => {
          const manager = MANAGER_CHOICES.find((candidate) => candidate === value)
          if (manager) {
            onChange({ ...choice, manager })
          }
        }}
      >
        <ManagerOption
          value="auto"
          label={t('seal.machineServer.add.managerAuto', 'Automatic (recommended)')}
          help={t(
            'seal.machineServer.add.managerAutoHelp',
            'PM2 when the machine has it, otherwise a systemd user service.'
          )}
        />
        <ManagerOption
          value="systemd-user"
          label={t('seal.machineServer.add.managerSystemd', 'systemd user service')}
          help={t(
            'seal.machineServer.add.managerSystemdHelp',
            'For Linux machines that run systemd.'
          )}
        />
        <ManagerOption
          value="pm2"
          label={t('seal.machineServer.add.managerPm2', 'PM2')}
          help={t('seal.machineServer.add.managerPm2Help', 'For machines that have PM2 installed.')}
        />
        <ManagerOption
          value="launchd"
          label={t('seal.machineServer.add.managerLaunchd', 'launchd user service (experimental)')}
          help={t(
            'seal.machineServer.add.managerLaunchdHelp',
            'macOS only. Starts when you log in at the Mac’s screen, so not on a headless Mac. Not yet tested on a real Mac.'
          )}
        />
      </RadioGroup>
    </div>
  )
}
