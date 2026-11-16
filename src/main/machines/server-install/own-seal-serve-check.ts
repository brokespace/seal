/** Seal installs no server beside one the user already runs as a service: every install asks the host first. */
import {
  awaitsServerInstall,
  DECLINED_SERVER_INSTALL,
  setMachineServerInstall
} from '../../../shared/machines/machine-server-install'
import type { MachineView } from '../../../shared/machines/machine-view'
import {
  readOwnSealServe,
  type OwnSealServe
} from '../../managed-server/service/own-seal-serve-probe'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import type { MachineRegistry } from '../registry/machine-registry'
import { forgetOwnSealServe, noteOwnSealServe } from './machine-server-install-activity'
import { connectedSshSession } from './machine-ssh-session'

const asked = new Set<string>()

/** Remembers the host's answer; a found service calls off an install that waits on this machine. */
export async function checkHostForOwnSealServe(
  registry: MachineRegistry,
  sshTargetId: string,
  session: SshConnection
): Promise<OwnSealServe | null> {
  asked.add(sshTargetId)
  const found = await readOwnSealServe(session)
  noteOwnSealServe(sshTargetId, found)
  const record = found ? registry.recordForSshTarget(sshTargetId) : null
  if (record && awaitsServerInstall(record.serverInstall)) {
    registry.edit((store, now) =>
      setMachineServerInstall(store, record.id, DECLINED_SERVER_INSTALL, now)
    )
  }
  return found
}

/** The machine now connects through that server; back on SSH, the host is asked again. */
export function forgetOwnSealServeAnswer(sshTargetId: string): void {
  asked.delete(sshTargetId)
  forgetOwnSealServe(sshTargetId)
}

/** Asks each SSH machine once per app run, and only over an SSH session that is already open. */
export function learnOwnSealServes(registry: MachineRegistry, views: readonly MachineView[]): void {
  for (const view of views) {
    const sshTargetId = view.ssh?.targetId
    if (view.connection !== 'ssh' || !sshTargetId || asked.has(sshTargetId)) {
      continue
    }
    const session = connectedSshSession(sshTargetId)
    if (!session) {
      continue
    }
    void checkHostForOwnSealServe(registry, sshTargetId, session).catch((error: unknown) => {
      console.info(
        '[machines] could not read whether a machine runs a Seal server of its own:',
        error instanceof Error ? error.message : error
      )
    })
  }
}
