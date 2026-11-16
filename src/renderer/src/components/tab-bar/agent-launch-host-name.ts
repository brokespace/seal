import { selectExecutionHostDisplayLabel } from '@/runtime/hosts/display/execution-host-display-label'
import { useAppStateValue } from '@/store/retained-views/app-state-view'
import { parseExecutionHostId } from '../../../../shared/execution-host/execution-host'

/** The machine an agent launches on, as a launcher reason names it; null for this computer. */
export function useAgentLaunchHostName(executionHostId: string | undefined): string | null {
  return useAppStateValue((state) => {
    const host = parseExecutionHostId(executionHostId)
    return host && host.kind !== 'local' ? selectExecutionHostDisplayLabel(state, host.id) : null
  })
}
