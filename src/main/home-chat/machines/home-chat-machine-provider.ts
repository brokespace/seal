import { hostname } from 'node:os'
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
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { HomeChatMachineNote } from '../../../shared/home-chat/home-chat-memory-types'
import {
  buildMachineSummaries,
  type MachineSummary
} from '../../../shared/machines/machine-summaries'
import type { SshConnectionState, SshTarget } from '../../../shared/ssh-types'
import { createHopMachine, hopMachineInfo, isHopNote } from './home-chat-hop-machine'
import { createLocalMachine } from './home-chat-local-machine'
import { createRuntimeMachine, type HomeChatRuntimeSource } from './home-chat-runtime-machine'
import { createSshMachine, sshMachineInfo } from './home-chat-ssh-machine'
import {
  LOCAL_MACHINE_ID,
  type HomeChatMachine,
  type HomeChatMachineInfo,
  type HomeChatMachineProvider
} from './home-chat-machine-types'

/** Where Seal's machines come from; the defaults read the same registries the Machines page does. */
export type HomeChatMachineSources = {
  sshTargets: () => SshTarget[]
  sshState: (targetId: string) => SshConnectionState | undefined
  runtimes: HomeChatRuntimeSource | null
}

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
 * Match what the user or model called a machine: its id, label, or host name. No match and several
 * matches are errors that list the choices, so the model can correct itself in one step.
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
    const id = m.id.toLowerCase()
    return (
      id === wanted ||
      id === `ssh:${wanted}` ||
      id === `runtime:${wanted}` ||
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
  const note = notes.find((n) => n.machine === info.id)
  return note?.notes ? { ...info, notes: note.notes } : info
}

function summaryInfo(
  summary: MachineSummary,
  targets: readonly SshTarget[],
  localInfo: HomeChatMachineInfo,
  sshState: HomeChatMachineSources['sshState']
): HomeChatMachineInfo {
  if (summary.kind === 'local') {
    return localInfo
  }
  const target = targets.find((t) => t.id === summary.sshTargetId)
  if (summary.kind === 'ssh' && target) {
    return {
      ...sshMachineInfo(target, sshState(target.id)),
      label: summary.label,
      ...(summary.os ? { platform: summary.os } : {}),
      ...(summary.hasRuntime ? { sealServer: true } : {})
    }
  }
  return {
    id: summary.id,
    label: summary.label,
    kind: 'runtime',
    ...(summary.address ? { address: summary.address } : {}),
    via: 'Seal server',
    connected: summary.status === 'online',
    status: summary.status,
    ...(summary.statusDetail ? { statusDetail: summary.statusDetail } : {}),
    sealServer: true,
    ...(summary.os ? { platform: summary.os } : {})
  }
}

const WINDOWS_FALLBACK = getRemoteHostPlatform('win32-x64')

/** This computer and SSH hosts; the desktop adds its paired Seal servers. */
export const SSH_MACHINE_SOURCES: HomeChatMachineSources = {
  sshTargets: listRegisteredSshTargets,
  sshState: getRegisteredSshState,
  runtimes: null
}

export function createDefaultHomeChatMachineProvider(
  machineNotes: () => readonly HomeChatMachineNote[],
  sources: HomeChatMachineSources = SSH_MACHINE_SOURCES
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
    const targets = sources.sshTargets()
    const summaries = buildMachineSummaries({
      localName: hostname(),
      localOs: null,
      sshTargets: targets,
      sshStates: new Map(
        targets.flatMap((target) => {
          const state = sources.sshState(target.id)
          return state ? [[target.id, state] as const] : []
        })
      ),
      runtimeEnvironments: sources.runtimes?.environments() ?? [],
      runtimeStatuses: new Map(
        (sources.runtimes?.statuses() ?? []).map((snapshot) => [snapshot.environmentId, snapshot])
      )
    })
    const direct = summaries
      .map((summary) => summaryInfo(summary, targets, local.info, sources.sshState))
      .map((info) => withNotes(info, notes))
    const hops = notes
      .filter(isHopNote)
      .map((note) =>
        hopMachineInfo(note, direct.find((m) => m.id === note.via)?.connected ?? false)
      )
    return Promise.resolve([...direct, ...hops])
  }

  const openSsh = async (info: HomeChatMachineInfo, targetId: string): Promise<HomeChatMachine> => {
    const target = sources.sshTargets().find((t) => t.id === targetId && !t.owner)
    if (!target) {
      throw new Error(`SSH machine ${info.id} is no longer configured`)
    }
    let conn = getSshConnectionManager()?.getConnection(targetId)
    if (conn?.getState().status !== 'connected') {
      const state = await connectRegisteredSshTarget(targetId, { automatic: true })
      if (state.status !== 'connected') {
        throw new Error(
          `Could not connect to ${target.label}: ${state.error ?? state.status}. It may be powered off or need the user to sign in; they can connect it on the Machines page.`
        )
      }
      conn = getSshConnectionManager()?.getConnection(targetId)
    }
    if (!conn) {
      throw new Error(`No SSH connection to ${target.label}`)
    }
    const note = machineNotes().find((n) => n.machine === info.id)
    const machine = createSshMachine(target, conn, await detectPlatform(targetId, conn, note))
    return {
      ...machine,
      info: withNotes(
        { ...machine.info, label: info.label, sealServer: info.sealServer },
        machineNotes()
      )
    }
  }

  const openRuntime = (info: HomeChatMachineInfo, environmentId: string): HomeChatMachine => {
    if (!sources.runtimes) {
      throw new Error(`${info.label} is paired through a Seal server, which is not available here.`)
    }
    if (info.status !== 'online') {
      throw new Error(
        `${info.label} is ${info.status}${info.statusDetail ? ` (${info.statusDetail})` : ''}: its Seal server is not reachable right now. Ask the user to check that the machine is on and Seal is running there, or reconnect it on the Machines page.`
      )
    }
    return createRuntimeMachine(info, environmentId, sources.runtimes)
  }

  const open = async (query: string, depth = 0): Promise<HomeChatMachine> => {
    const machines = await list()
    const id = resolveHomeChatMachineId(query, machines)
    if (id === LOCAL_MACHINE_ID) {
      return local
    }
    const info = machines.find((m) => m.id === id)
    const parsed = parseExecutionHostId(id)
    if (info && parsed?.kind === 'ssh') {
      return openSsh(info, parsed.targetId)
    }
    if (info && parsed?.kind === 'runtime') {
      return openRuntime(info, parsed.environmentId)
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
