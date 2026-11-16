import type { MachineConnectionType, MachineServerInstall } from './machine-record'
import type { MachineId } from './machine-types'

export type MachineSshDetails = {
  targetId: string
  /** `user@host:port`. */
  address: string
  host: string
  username: string
  port: number
  identityFile: string | null
  jumpHost: string | null
}

export type MachineServerDetails = {
  environmentId: string
  name: string
  /** The preferred endpoint, or null for relay-only pairings. */
  endpoint: string | null
}

/** One machine as the renderer sees it; status comes from the live SSH and server states. */
export type MachineView = {
  id: MachineId
  recordId: string
  name: string
  /** The transport Seal uses now; the other one's details stay for one-click switching. */
  connection: MachineConnectionType
  ssh: MachineSshDetails | null
  server: MachineServerDetails | null
  /** Null on machines that never decided: nothing is installed on them without being asked. */
  serverInstall: MachineServerInstall | null
  /** What Seal can do about its server on this machine now. */
  serverInstallAction: MachineServerInstallAction
  /** Set while a failed move can still go ahead by leaving saved items on this computer. */
  serverMoveBlocked?: { detail: string | null }
  /** PM2 only: whether the user's own `pm2 startup` is set up; null or absent when not known. */
  serverStartsAtBoot?: boolean | null
  /** The machine is connected through a server its user runs; Seal did not deploy it. */
  serverRunByUser?: true
  /** How the machine's server is kept running, when known; also set for a server the user runs. */
  serverKeeper?: NonNullable<MachineServerInstall['manager']>
  /** Seal's server was stopped but its service may still be registered here; Remove can run again. */
  serverServiceRemains?: true
  /** The account the machine names itself (`id -un`), once its service was probed; never the SSH details' username. */
  serverHostUser?: string
  /** A `seal serve` service the user already runs on this SSH machine: Seal installs no second server and offers to use this one. */
  serverOwnServe?: { manager: 'systemd-user' | 'launchd'; name: string }
  /** macOS: launchd was asked for but no one is logged in at the screen, so the server is not a service. */
  serverLaunchdNeedsLogin?: true
  /** The running install waits for another install on the machine to finish or to be given up. */
  serverInstallWaitsForHost?: true
}

/**
 * `offer`: an SSH machine that never decided gets the one-time notice.
 * `install`: an SSH machine that declined or unticked the box can still install.
 * `retry`: the last install failed or waits for terminals to close; the machine connects over plain SSH.
 * `installing`: an install is running.
 * `reuse`: the machine already runs the user's own `seal serve` service; Seal can connect through it instead of installing.
 * `keep-running`: a server runs here that is not a service yet, and Seal can make it one over SSH.
 * `own-server`: the user runs this server and Seal has no SSH details for the machine, so only
 *   `seal serve service install` on the host applies.
 * `none`: nothing to offer.
 */
export type MachineServerInstallAction =
  | 'offer'
  | 'install'
  | 'retry'
  | 'installing'
  | 'reuse'
  | 'keep-running'
  | 'own-server'
  | 'none'

/**
 * `auto`: PM2 when the machine has it, otherwise a systemd user service. The others ask for that
 * manager first. launchd is experimental and never picked by `auto`.
 */
export type MachineServiceManagerChoice = 'auto' | 'systemd-user' | 'launchd' | 'pm2'

export type MachineServerInstallRequest = {
  machineId: MachineId
  manager?: MachineServiceManagerChoice
  /** Go ahead with a move that leaves the listed saved items on this computer. */
  moveAnyway?: boolean
}

export type MachineWorktree = {
  path: string
  branch: string | null
  head: string | null
  bare: boolean
}
