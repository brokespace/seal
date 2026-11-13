import {
  connectRegisteredSshTarget,
  getRegisteredSshState,
  getSshConnectionManager,
  listRegisteredSshTargets
} from '../../ssh/targets/ssh-target-registry'
import type { SshTarget } from '../../../shared/ssh-types'
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
  const exact = machines.find(
    (m) => m.id.toLowerCase() === wanted || m.id.toLowerCase() === `ssh:${wanted}`
  )
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

export function createDefaultHomeChatMachineProvider(): HomeChatMachineProvider {
  const local = createLocalMachine()
  const list = (): Promise<HomeChatMachineInfo[]> =>
    Promise.resolve([
      local.info,
      ...userSshTargets().map((target) =>
        sshMachineInfo(target, getRegisteredSshState(target.id)?.status === 'connected')
      )
    ])
  return {
    list,
    open: async (query): Promise<HomeChatMachine> => {
      const id = resolveHomeChatMachineId(query, await list())
      if (id === LOCAL_MACHINE_ID) {
        return local
      }
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
      return createSshMachine(target, conn)
    }
  }
}
