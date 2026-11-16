import type { MachineConnectionType, MachineServerInstall } from './machine-record'
import {
  installedServerKeeper,
  serverServiceRemains,
  type MachineServerKeeper
} from './machine-server-install'
import type { MachineServerInstallAction } from './machine-view'

export type MachineServerInstallFacts = {
  /** The transport the machine uses now. */
  connection: MachineConnectionType
  hasSshDetails: boolean
  serverInstall: MachineServerInstall | null
  /** An install, or a restart into a service, is running. */
  installing: boolean
  /**
   * `own-target`: Seal deployed the machine's server over the machine's own SSH target.
   * `other-target`: Seal deployed it over an SSH target this machine does not hold.
   * `null`: the user runs the server, or the machine has none.
   */
  managedServer: 'own-target' | 'other-target' | null
  /** What the host last reported; for Seal's own server the record answers until it has. */
  reportedKeeper: MachineServerKeeper | null
}

/** What Seal can do about its server on a machine now. */
export function machineServerInstallAction(
  facts: MachineServerInstallFacts
): MachineServerInstallAction {
  if (facts.connection === 'ssh') {
    return sshMachineAction(facts)
  }
  if (facts.managedServer === 'other-target') {
    return 'none'
  }
  if (facts.managedServer === null && !facts.hasSshDetails) {
    return 'own-server'
  }
  if (facts.installing) {
    return 'installing'
  }
  // The record only knows the keeper of a server Seal installed.
  const keeper =
    facts.reportedKeeper ??
    (facts.managedServer ? installedServerKeeper(facts.serverInstall) : null)
  return keeper && keeper !== 'detached' ? 'none' : 'keep-running'
}

function sshMachineAction(facts: MachineServerInstallFacts): MachineServerInstallAction {
  if (!facts.hasSshDetails) {
    return 'none'
  }
  if (facts.installing) {
    return 'installing'
  }
  const install = facts.serverInstall
  switch (install?.state) {
    case undefined:
      return 'offer'
    case 'failed':
      return 'retry'
    case 'declined':
      return 'install'
    case 'pending':
      // A reason on a pending install says what it waits for.
      return install.reason ? 'retry' : 'install'
    case 'installed':
      // On `auto` the user switched this machine to SSH; its server stays one switch away.
      return serverServiceRemains(install) ? 'install' : 'none'
  }
}
