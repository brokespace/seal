import type { MachineView } from '../../../shared/machines/machine-view'
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

/** Match an id, a bare SSH target id, or a label; ambiguity is an error the model can act on. */
export function resolveHomeChatMachineId(
  query: string,
  machines: readonly HomeChatMachineInfo[]
): string {
  const wanted = query.trim().toLowerCase()
  if (!wanted || wanted === 'local' || wanted === 'localhost' || wanted === 'this computer') {
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
  const byLabel = machines.filter((m) => m.label.toLowerCase() === wanted)
  const candidates =
    byLabel.length > 0 ? byLabel : machines.filter((m) => m.label.toLowerCase().includes(wanted))
  if (candidates.length === 1) {
    return candidates[0].id
  }
  const known = machines.map((m) => `${m.label} (${m.id})`).join(', ')
  throw new Error(
    candidates.length === 0
      ? `No machine matches "${query}". Known machines: ${known}`
      : `"${query}" matches several machines: ${candidates.map((m) => m.id).join(', ')}`
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

export type HomeChatMachineSource = {
  list: () => readonly MachineView[]
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
      ...machines
        .list()
        .map((view) => unifiedMachineInfo(view, machines.connection(view.id).isConnected()))
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
      const machine = await createUnifiedMachine(view, machines.connection(id))
      return { ...machine, info: withNotes(machine.info, machineNotes()) }
    } catch (error) {
      throw new Error(
        `Could not connect to ${view.name}: ${error instanceof Error ? error.message : String(error)}. Ask the user to connect it in Seal.`
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
