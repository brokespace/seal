import React, { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
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

/** Whether a new SSH machine gets Seal's server, and how the server is kept running. */
export function AddMachineServerInstallOptions({
  choice,
  onChange
}: {
  choice: MachineServerInstallChoice
  onChange: (choice: MachineServerInstallChoice) => void
}): React.JSX.Element {
  const t = useTranslate()
  const managerLabelId = useId()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  return (
    <div className="space-y-1" data-add-machine-server-install>
      <label className="flex items-start gap-2 text-xs">
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
      {choice.install ? (
        // The trigger's own padding brings its label under the checkbox's text.
        <div className="pl-4">
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="xs">
                {t('w7.add.advanced', 'Advanced server options')}
                <ChevronDown
                  className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 pt-2 pb-1 pl-2">
                <p id={managerLabelId} className="text-xs font-medium">
                  {t('w7.add.manager', 'How the server is kept running')}
                </p>
                <RadioGroup
                  aria-labelledby={managerLabelId}
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
                    help={t(
                      'w7.add.managerPm2Help',
                      'Use PM2 when it is installed on the machine.'
                    )}
                  />
                </RadioGroup>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
    </div>
  )
}
