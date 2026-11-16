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
  /** The host already runs a `seal serve` service of the user's own. */
  ownServe: boolean
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
  if (!facts.managedServer) {
    // Only the machine can say that a server its user runs is not a service, so nothing is offered until it has.
    return facts.reportedKeeper === 'detached' ? 'keep-running' : 'none'
  }
  // The record knows the keeper of a server Seal installed.
  const keeper = facts.reportedKeeper ?? installedServerKeeper(facts.serverInstall)
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
  // On `auto` the user switched this machine to SSH; its server stays one switch away.
  if (install?.state === 'installed' && !serverServiceRemains(install)) {
    return 'none'
  }
  // The user's own server already runs here, so nothing is installed beside it.
  if (facts.ownServe) {
    return 'reuse'
  }
  switch (install?.state) {
    case undefined:
      return 'offer'
    case 'failed':
      return 'retry'
    case 'pending':
      // A reason on a pending install says what it waits for.
      return install.reason ? 'retry' : 'install'
    case 'declined':
    case 'installed':
      return 'install'
  }
}
