import type { MachineProcessAgent } from '../../../../../shared/machines/machine-resource-types'

/** Product names, the same in every language. */
export const MACHINE_AGENT_NAMES: Record<MachineProcessAgent, string> = {
  claude: 'Claude',
  codex: 'Codex'
}
