import type { MachineView } from '../../../shared/machines/machine-view'
import type { MachineSummary } from '../../../shared/machines/machine-summaries'
import type { MachineConnection } from '../../machines/connection/machine-connection'
import type { HomeChatMachineNote } from '../../../shared/home-chat/home-chat-memory-types'
import { createHopMachine, hopMachineInfo, isHopNote } from './home-chat-hop-machine'
import { createLocalMachine } from './home-chat-local-machine'
import { createUnifiedMachine, unifiedMachineInfo } from './home-chat-unified-machine'
import {
  LOCAL_MACHINE_ID,
  type HomeChatMachine,
  type HomeChatMachineInfo,
  type HomeChatMachineProvider
} from './home-chat-machine-types'

const LOCAL_NAMES = new Set(['', 'local', 'localhost', 'this computer', 'this machine', 'here'])

function hostOf(address: string | undefined): string {
  return (address ?? '')
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
}

function describe(machine: HomeChatMachineInfo): string {
  return `${machine.label} (${machine.id}, ${machine.status})`
}

/**
 * Match what the user or model called a machine: its id (or an older `ssh:` spelling), label, or
 * host name. No match and several matches are errors that list the choices, so the model can
 * correct itself in one step.
 */
export function resolveHomeChatMachineId(
  query: string,
  machines: readonly HomeChatMachineInfo[]
): string {
  const wanted = query.trim().toLowerCase()
  if (LOCAL_NAMES.has(wanted)) {
    return LOCAL_MACHINE_ID
  }
  const exact = machines.find((m) => {
    const ids = [m.id, ...(m.aliases ?? [])].map((id) => id.toLowerCase())
    return ids.some(
      (id) =>
        id === wanted ||
        id === `ssh:${wanted}` ||
        id === `machine:${wanted}` ||
        id === `hop:${wanted}`
    )
  })
  if (exact) {
    return exact.id
  }
  const tiers: ((m: HomeChatMachineInfo) => boolean)[] = [
    (m) => m.label.toLowerCase() === wanted,
    (m) => hostOf(m.address) === wanted || hostOf(m.address).split('.')[0] === wanted,
    (m) => m.label.toLowerCase().includes(wanted) || hostOf(m.address).includes(wanted)
  ]
  for (const tier of tiers) {
    const matches = machines.filter(tier)
    if (matches.length === 1) {
      return matches[0].id
    }
    if (matches.length > 1) {
      throw new Error(
        `"${query}" matches several machines: ${matches.map(describe).join(', ')}. Use one of these ids.`
      )
    }
  }
  throw new Error(
    `No machine matches "${query}". Machines Seal knows: ${machines.map(describe).join(', ')}. If it should exist, the user can add it on the Machines page, or you can define it with configure_machine as hop:<name> reached through another machine.`
  )
}

function withNotes(
  info: HomeChatMachineInfo,
  notes: readonly HomeChatMachineNote[]
): HomeChatMachineInfo {
  const ids = new Set([info.id, ...(info.aliases ?? [])])
  const note = notes.find((n) => ids.has(n.machine))
  return note?.notes ? { ...info, notes: note.notes } : info
}

/** The same machines the Machines page lists, each with the status of the transport it uses. */
export type HomeChatMachineSource = {
  list: () => readonly MachineView[]
  summarize: (view: MachineView) => MachineSummary
  connection: (machineId: string) => MachineConnection
}

export function createDefaultHomeChatMachineProvider(
  machineNotes: () => readonly HomeChatMachineNote[],
  machines: HomeChatMachineSource
): HomeChatMachineProvider {
  const local = createLocalMachine()

  const list = (): Promise<HomeChatMachineInfo[]> => {
    const notes = machineNotes()
    const direct = [
      local.info,
      ...machines.list().map((view) => unifiedMachineInfo(view, machines.summarize(view)))
    ].map((info) => withNotes(info, notes))
    const viaOf = (via: string | undefined) =>
      direct.find((m) => m.id === via || m.aliases?.includes(via ?? ''))
    const hops = notes
      .filter(isHopNote)
      .map((note) => hopMachineInfo(note, viaOf(note.via)?.connected ?? false))
    return Promise.resolve([...direct, ...hops])
  }

  const openMachine = async (id: string): Promise<HomeChatMachine> => {
    const view = machines.list().find((candidate) => candidate.id === id)
    if (!view) {
      throw new Error(`Machine ${id} is no longer configured`)
    }
    try {
      const machine = await createUnifiedMachine(
        view,
        machines.summarize(view),
        machines.connection(id)
      )
      return { ...machine, info: withNotes(machine.info, machineNotes()) }
    } catch (error) {
      throw new Error(
        `Could not connect to ${view.name}: ${error instanceof Error ? error.message : String(error)}. It may be powered off or need the user to sign in; they can connect it on the Machines page.`
      )
    }
  }

  const open = async (query: string, depth = 0): Promise<HomeChatMachine> => {
    const id = resolveHomeChatMachineId(query, await list())
    if (id === LOCAL_MACHINE_ID) {
      return local
    }
    if (id.startsWith('machine:')) {
      return openMachine(id)
    }
    const note = machineNotes().find((n) => n.machine === id && isHopNote(n))
    if (!note?.via) {
      throw new Error(`${id} has no route; set its via machine and host with configure_machine.`)
    }
    if (depth > 4) {
      throw new Error(`${id} is reached through too many hops (or a loop).`)
    }
    return createHopMachine(note, await open(note.via, depth + 1))
  }

  return { list, open: (query) => open(query) }
}
