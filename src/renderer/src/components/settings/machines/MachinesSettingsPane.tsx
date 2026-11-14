import React, { useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight, EllipsisVertical } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  AddMachineDialog,
  AddMachineMenu,
  type AddMachineRequest
} from '../../machines/add/AddMachineFlow'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { MachineStatusDot, useMachineStatusLabel } from '../../machines/detail/MachineVitals'
import { switchMachineConnection } from '../../machines/detail/machine-quick-actions'
import { MachineConnectionBadge } from '../../machines/list/MachineConnectionBadge'
import { useMachinesInventory } from '../../machines/model/use-machines-inventory'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sshDetails(view: MachineView): string | null {
  if (!view.ssh) {
    return null
  }
  const user = view.ssh.username ? `${view.ssh.username}@` : ''
  const port = view.ssh.port && view.ssh.port !== 22 ? `:${view.ssh.port}` : ''
  return `${user}${view.ssh.host}${port}`
}

function MachineSettingsRow({
  machine,
  view,
  onAdd,
  onChanged
}: {
  machine: MachineSummary
  view: MachineView
  onAdd: (request: AddMachineRequest) => void
  onChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useMachineStatusLabel()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(machine.label)
  const [switching, setSwitching] = useState(false)
  const ssh = sshDetails(view)
  const server = view.server?.endpoint ?? view.server?.name ?? null

  const rename = async (): Promise<void> => {
    const next = name.trim()
    setRenaming(false)
    if (!next || next === machine.label) {
      return
    }
    try {
      await window.api.machines?.renameMachine({ machineId: machine.id, name: next })
      onChanged()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const choose = async (next: string): Promise<void> => {
    if ((next !== 'ssh' && next !== 'server') || next === machine.connection) {
      return
    }
    setSwitching(true)
    await switchMachineConnection(machine, next)
    setSwitching(false)
    onChanged()
  }

  const separate = async (): Promise<void> => {
    try {
      await window.api.machines?.separate({ machineId: machine.id })
      onChanged()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <MachineStatusDot status={machine.status} />
          {renaming ? (
            <Input
              autoFocus
              value={name}
              className="h-6 max-w-56"
              aria-label={t('auto.components.settings.machines.name', 'Machine name')}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void rename()
                } else if (event.key === 'Escape') {
                  setName(machine.label)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <span className="truncate text-sm font-medium">{machine.label}</span>
          )}
          <MachineConnectionBadge connection={machine.connection} />
          <span className="shrink-0 text-2xs text-muted-foreground">
            {statusLabel(machine.status)}
          </span>
        </div>
        <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-2xs text-muted-foreground">
          <dt>{t('auto.components.settings.machines.sshLabel', 'SSH')}</dt>
          <dd className="truncate font-mono">
            {ssh ?? t('auto.components.settings.machines.notSet', 'Not set up')}
          </dd>
          <dt>{t('auto.components.settings.machines.serverLabel', 'Seal server')}</dt>
          <dd className="truncate font-mono">
            {server ?? t('auto.components.settings.machines.notSet', 'Not set up')}
          </dd>
        </dl>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={machine.connection}
          disabled={switching}
          aria-label={t('auto.components.settings.machines.connectsVia', 'Connects via')}
          onValueChange={(next) => void choose(next)}
        >
          <ToggleGroupItem value="ssh" disabled={!view.ssh}>
            {t('auto.components.machines.connection.ssh', 'SSH')}
          </ToggleGroupItem>
          <ToggleGroupItem value="server" disabled={!view.server}>
            {t('auto.components.machines.connection.server', 'Seal server')}
          </ToggleGroupItem>
        </ToggleGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('auto.components.settings.machines.more', 'More actions')}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setName(machine.label)
                setRenaming(true)
              }}
            >
              {t('auto.components.settings.machines.rename', 'Rename')}
            </DropdownMenuItem>
            {view.ssh ? null : (
              <DropdownMenuItem
                onSelect={() =>
                  onAdd({ mode: 'ssh', machineId: machine.id, keepConnection: 'server' })
                }
              >
                {t('auto.components.settings.machines.addSsh', 'Add SSH details…')}
              </DropdownMenuItem>
            )}
            {view.server ? null : (
              <DropdownMenuItem
                onSelect={() =>
                  onAdd({ mode: 'server', machineId: machine.id, keepConnection: 'ssh' })
                }
              >
                {t('auto.components.settings.machines.pairServer', 'Pair a Seal server…')}
              </DropdownMenuItem>
            )}
            {view.ssh && view.server ? (
              <DropdownMenuItem onSelect={() => void separate()}>
                {t(
                  'auto.components.settings.machines.separate',
                  'These are different machines — split'
                )}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

export function MachinesSettingsPane({
  sshAddSignal,
  serverAddSignal,
  advanced
}: {
  sshAddSignal: number
  serverAddSignal: number
  /** Full SSH and server settings (keys, forwards, pairing links) for anything the rows don't cover. */
  advanced: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const { machines, views, reload } = useMachinesInventory('')
  const [adding, setAdding] = useState<AddMachineRequest | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Intent signals open the add flow; compare during render so the dialog opens on the same paint.
  const [seenSignals, setSeenSignals] = useState({ ssh: sshAddSignal, server: serverAddSignal })
  if (sshAddSignal !== seenSignals.ssh || serverAddSignal !== seenSignals.server) {
    setSeenSignals({ ssh: sshAddSignal, server: serverAddSignal })
    setAdding({ mode: sshAddSignal !== seenSignals.ssh ? 'ssh' : 'server', machineId: null })
  }

  const remote = machines.filter((machine) => machine.connection !== 'local')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t(
            'auto.components.settings.machines.summary',
            'Each machine connects over SSH or through a Seal server running on it. Every feature works the same either way.'
          )}
        </p>
        <AddMachineMenu onPick={(mode) => setAdding({ mode, machineId: null })} />
      </div>

      {remote.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {t('auto.components.settings.machines.empty', 'No machines yet.')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {remote.map((machine) => {
            const view = views.find((candidate) => candidate.id === machine.id)
            return view ? (
              <MachineSettingsRow
                key={machine.id}
                machine={machine}
                view={view}
                onAdd={setAdding}
                onChanged={reload}
              />
            ) : null
          })}
        </ul>
      )}

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="-ml-2">
            <ChevronRight className={advancedOpen ? 'rotate-90' : undefined} />
            {t(
              'auto.components.settings.machines.advanced',
              'SSH keys, port forwards and server pairing'
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-6 pt-2">{advanced}</div>
        </CollapsibleContent>
      </Collapsible>

      <AddMachineDialog request={adding} onClose={() => setAdding(null)} onAdopted={reload} />
    </div>
  )
}
