import {
  connectRegisteredSshTarget,
  getRegisteredSshState,
  getSshConnectionManager,
  listRegisteredSshTargets
} from '../../ssh/targets/ssh-target-registry'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import {
  getRemoteHostPlatform,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import type { SshTarget } from '../../../shared/ssh-types'
import type { HomeChatMachineNote } from '../../../shared/home-chat/home-chat-memory-types'
import { createHopMachine, hopMachineInfo, isHopNote } from './home-chat-hop-machine'
import { createLocalMachine } from './home-chat-local-machine'
import { createSshMachine, sshMachineInfo } from './home-chat-ssh-machine'
import {
  LOCAL_MACHINE_ID,
  type HomeChatMachine,
  type HomeChatMachineInfo,
  type HomeChatMachineProvider
} from './home-chat-machine-types'

function userSshTargets(): SshTarget[] {
  return listRegisteredSshTargets().filter((target) => !target.owner)
}

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
    const id = m.id.toLowerCase()
    return id === wanted || id === `ssh:${wanted}` || id === `hop:${wanted}`
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
  const note = notes.find((n) => n.machine === info.id)
  return note?.notes ? { ...info, notes: note.notes } : info
}

const WINDOWS_FALLBACK = getRemoteHostPlatform('win32-x64')

export function createDefaultHomeChatMachineProvider(
  machineNotes: () => readonly HomeChatMachineNote[]
): HomeChatMachineProvider {
  const local = createLocalMachine()
  const platforms = new Map<string, { generation: number; host: RemoteHostPlatform | null }>()

  const detectPlatform = async (
    targetId: string,
    conn: SshConnection,
    note: HomeChatMachineNote | undefined
  ): Promise<RemoteHostPlatform | null> => {
    const generation = conn.getConnectGeneration()
    const cached = platforms.get(targetId)
    if (cached?.generation === generation) {
      return cached.host
    }
    const host = await detectRemoteHostPlatform(conn).catch(() =>
      note?.os === 'windows' ? WINDOWS_FALLBACK : null
    )
    platforms.set(targetId, { generation, host })
    return host
  }

  const list = (): Promise<HomeChatMachineInfo[]> => {
    const notes = machineNotes()
    const direct = [
      local.info,
      ...userSshTargets().map((target) =>
        sshMachineInfo(target, getRegisteredSshState(target.id)?.status === 'connected')
      )
    ].map((info) => withNotes(info, notes))
    const hops = notes
      .filter(isHopNote)
      .map((note) =>
        hopMachineInfo(note, direct.find((m) => m.id === note.via)?.connected ?? false)
      )
    return Promise.resolve([...direct, ...hops])
  }

  const openSsh = async (id: string): Promise<HomeChatMachine> => {
    const targetId = id.slice('ssh:'.length)
    const target = userSshTargets().find((t) => t.id === targetId)
    if (!target) {
      throw new Error(`SSH machine ${id} is no longer configured`)
    }
    let conn = getSshConnectionManager()?.getConnection(targetId)
    if (conn?.getState().status !== 'connected') {
      const state = await connectRegisteredSshTarget(targetId, { automatic: true })
      if (state.status !== 'connected') {
        throw new Error(
          `Could not connect to ${target.label}: ${state.error ?? state.status}. Ask the user to connect it in Seal.`
        )
      }
      conn = getSshConnectionManager()?.getConnection(targetId)
    }
    if (!conn) {
      throw new Error(`No SSH connection to ${target.label}`)
    }
    const note = machineNotes().find((n) => n.machine === id)
    const machine = createSshMachine(target, conn, await detectPlatform(targetId, conn, note))
    return { ...machine, info: withNotes(machine.info, machineNotes()) }
  }

  const open = async (query: string, depth = 0): Promise<HomeChatMachine> => {
    const id = resolveHomeChatMachineId(query, await list())
    if (id === LOCAL_MACHINE_ID) {
      return local
    }
    if (id.startsWith('ssh:')) {
      return openSsh(id)
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
