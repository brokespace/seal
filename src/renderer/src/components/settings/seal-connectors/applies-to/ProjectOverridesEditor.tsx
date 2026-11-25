import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '../../../../store/index'
import { HostCombobox } from '../../../host-picker/HostCombobox'
import { SettingsBadge } from '../../form-controls/SettingsFormControls'
import type { ProjectOverride } from '../../../../../../shared/seal-connectors/seal-connectors-types'
import { appliesToLabel, type AppliesToOption } from './use-applies-to-options'

const EVERY_MACHINE = '__every__'

/** On or off for matching projects, whatever the machines, accounts and agents above say. */
export function ProjectOverridesEditor({
  overrides,
  machines,
  onChange
}: {
  overrides: readonly ProjectOverride[]
  machines: readonly AppliesToOption[]
  onChange: (overrides: ProjectOverride[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const repos = useAppStore((state) => state.repos)
  const [match, setMatch] = useState('')
  const [machine, setMachine] = useState(EVERY_MACHINE)
  const [state, setState] = useState<ProjectOverride['state']>('off')
  const trimmed = match.trim()
  const stateLabel = (value: ProjectOverride['state']): string =>
    value === 'on'
      ? t('seal.connectors.override.on', 'On')
      : t('seal.connectors.override.off', 'Off')

  const add = (): void => {
    if (!trimmed) {
      return
    }
    const repo = repos.find((entry) => entry.path === trimmed)
    onChange([
      ...overrides.filter((entry) => !(entry.match === trimmed && entry.machine === machineKey())),
      {
        match: trimmed,
        ...(machine === EVERY_MACHINE ? {} : { machine }),
        ...(repo ? { label: repo.displayName } : {}),
        state
      }
    ])
    setMatch('')
  }
  const machineKey = (): string | undefined => (machine === EVERY_MACHINE ? undefined : machine)

  return (
    <div className="space-y-2 pt-1" data-project-overrides="">
      <div className="space-y-0.5">
        <h4 className="text-sm font-medium">
          {t('seal.connectors.override.title', 'Project overrides')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t(
            'seal.connectors.override.description',
            'Turn it on or off for matching projects, whatever the lists above say.'
          )}
        </p>
      </div>
      {overrides.map((entry, index) => (
        <div
          key={`${entry.match}:${entry.machine ?? ''}`}
          className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm" title={entry.match}>
              {entry.label ?? entry.match}
            </p>
            <p className="truncate font-mono text-2xs text-muted-foreground">
              {entry.machine
                ? appliesToLabel(machines, entry.machine)
                : t('seal.connectors.override.everyMachine', 'Every machine')}
              {entry.label ? ` · ${entry.match}` : ''}
            </p>
          </div>
          <SettingsBadge tone={entry.state === 'on' ? 'accent' : 'muted'}>
            {stateLabel(entry.state)}
          </SettingsBadge>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('seal.connectors.override.remove', 'Remove override')}
            onClick={() => onChange(overrides.filter((_, at) => at !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={match}
          placeholder={t('seal.connectors.override.match', 'github.com/acme/*, a path or a folder')}
          aria-label={t('seal.connectors.override.matchLabel', 'Project to match')}
          onChange={(event) => setMatch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <HostCombobox
          value=""
          onChange={setMatch}
          size="sm"
          className="sm:w-44"
          placeholder={t('seal.connectors.override.pick', 'Pick a project')}
          ariaLabel={t('seal.connectors.override.pick', 'Pick a project')}
          options={repos.map((repo) => ({
            id: repo.path,
            label: repo.displayName,
            detail: repo.path
          }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HostCombobox
          value={machine}
          onChange={setMachine}
          size="sm"
          className="w-44"
          ariaLabel={t('seal.connectors.override.machine', 'Machine')}
          options={[
            {
              id: EVERY_MACHINE,
              label: t('seal.connectors.override.everyMachine', 'Every machine')
            },
            ...machines
          ]}
        />
        <Select value={state} onValueChange={(value) => setState(value === 'on' ? 'on' : 'off')}>
          <SelectTrigger
            size="sm"
            className="w-24"
            aria-label={t('seal.connectors.override.state', 'State')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="on">{stateLabel('on')}</SelectItem>
            <SelectItem value="off">{stateLabel('off')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={!trimmed} onClick={add}>
          <Plus />
          {t('seal.connectors.override.add', 'Add override')}
        </Button>
      </div>
    </div>
  )
}
