import { Monitor, Server } from 'lucide-react'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import type { ActiveAgentsMachine } from '../active-agents/active-agents-model'
import { LiveSessionRows } from './LiveSessionRows'

/** Sessions under the machine they run on, as a page card lists them (Home, a project's overview). */
export function LiveSessionMachineGroups({
  machines,
  now
}: {
  machines: readonly ActiveAgentsMachine[]
  now: number
}): React.JSX.Element {
  const machineName = useSessionMachineName()
  return (
    <div className="divide-y divide-border">
      {machines.map((machine) => {
        const MachineIcon = machine.kind === 'local' ? Monitor : Server
        return (
          <div key={machine.hostId} data-sessions-machine={machine.hostId} className="p-2">
            <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
              <MachineIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate">{machineName(machine)}</span>
              <span className="text-2xs font-normal text-muted-foreground tabular-nums">
                {machine.sessions.length}
              </span>
            </h3>
            <LiveSessionRows
              sessions={machine.sessions}
              label={machineName(machine)}
              now={now}
              layout="card"
            />
          </div>
        )
      })}
    </div>
  )
}
