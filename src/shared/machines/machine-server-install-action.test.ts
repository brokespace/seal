import { describe, expect, it } from 'vitest'
import type { MachineServerInstall } from './machine-record'
import {
  machineServerInstallAction,
  type MachineServerInstallFacts
} from './machine-server-install-action'

const sshMachine: MachineServerInstallFacts = {
  connection: 'ssh',
  hasSshDetails: true,
  serverInstall: null,
  installing: false,
  managedServer: null,
  reportedKeeper: null,
  ownServe: false
}
const serverMachine: MachineServerInstallFacts = {
  ...sshMachine,
  connection: 'server',
  managedServer: 'own-target'
}
const auto = (install: Partial<MachineServerInstall>): MachineServerInstall => ({
  policy: 'auto',
  state: 'installed',
  ...install
})

describe('machineServerInstallAction', () => {
  it.each([
    ['an SSH machine that never decided', sshMachine, 'offer'],
    ['an install in flight', { ...sshMachine, installing: true }, 'installing'],
    [
      'a failed install',
      {
        ...sshMachine,
        serverInstall: auto({ state: 'failed', reason: 'no space left on device' })
      },
      'retry'
    ],
    [
      'a declined install',
      { ...sshMachine, serverInstall: { policy: 'never', state: 'declined' } },
      'install'
    ],
    [
      'a pending install nothing is running',
      { ...sshMachine, serverInstall: auto({ state: 'pending' }) },
      'install'
    ],
    [
      'an installed server the user switched away from',
      { ...sshMachine, serverInstall: auto({ manager: 'systemd-user' }) },
      'none'
    ],
    [
      'an install waiting for terminals to close',
      {
        ...sshMachine,
        serverInstall: auto({ state: 'pending', reason: '2 terminals are still running' })
      },
      'retry'
    ],
    [
      'an SSH machine whose stopped server left its service behind',
      { ...sshMachine, serverInstall: { policy: 'never', state: 'installed', manager: 'pm2' } },
      'install'
    ],
    ['an SSH machine whose details are gone', { ...sshMachine, hasSshDetails: false }, 'none'],
    [
      'an undecided SSH machine that runs its own seal serve service',
      { ...sshMachine, ownServe: true },
      'reuse'
    ],
    [
      'a declined SSH machine that runs its own seal serve service',
      { ...sshMachine, ownServe: true, serverInstall: { policy: 'never', state: 'declined' } },
      'reuse'
    ],
    [
      'a failed install on a machine that runs its own seal serve service',
      {
        ...sshMachine,
        ownServe: true,
        serverInstall: auto({ state: 'failed', reason: 'no space left on device' })
      },
      'reuse'
    ],
    [
      'an install in flight on a machine that runs its own seal serve service',
      { ...sshMachine, ownServe: true, installing: true },
      'installing'
    ],
    [
      'its own seal serve service on a machine whose SSH details are gone',
      { ...sshMachine, ownServe: true, hasSshDetails: false },
      'none'
    ],
    [
      'a machine connected through its own seal serve service',
      { ...serverMachine, managedServer: null, ownServe: true, reportedKeeper: 'systemd-user' },
      'none'
    ],
    [
      'a Seal server kept by systemd',
      { ...serverMachine, serverInstall: auto({ manager: 'systemd-user' }) },
      'none'
    ],
    [
      'a Seal server the host reports as kept by PM2',
      { ...serverMachine, reportedKeeper: 'pm2' },
      'none'
    ],
    [
      'a Seal server that stops when idle',
      { ...serverMachine, serverInstall: auto({ manager: 'detached' }) },
      'keep-running'
    ],
    ['a Seal server whose keeper is unknown', serverMachine, 'keep-running'],
    [
      'a Seal server the host reports as detached',
      {
        ...serverMachine,
        serverInstall: auto({ manager: 'systemd-user' }),
        reportedKeeper: 'detached'
      },
      'keep-running'
    ],
    [
      'a Seal server being restarted into a service',
      { ...serverMachine, installing: true },
      'installing'
    ],
    [
      'a server the user runs on a machine without SSH details',
      { ...serverMachine, managedServer: null, hasSshDetails: false },
      'own-server'
    ],
    [
      'a server the user runs on a machine with SSH details',
      { ...serverMachine, managedServer: null },
      'keep-running'
    ],
    [
      'a server the user runs that reports it is a service',
      { ...serverMachine, managedServer: null, reportedKeeper: 'systemd-user' },
      'none'
    ],
    [
      'a server the user runs whose record remembers an earlier Seal install',
      { ...serverMachine, managedServer: null, serverInstall: auto({ manager: 'systemd-user' }) },
      'keep-running'
    ],
    [
      'a server the user runs while its service is installed',
      { ...serverMachine, managedServer: null, installing: true },
      'installing'
    ],
    [
      'a Seal server deployed over another SSH target',
      { ...serverMachine, managedServer: 'other-target' },
      'none'
    ]
  ] satisfies [string, MachineServerInstallFacts, string][])(
    '%s offers %s',
    (_case, facts, action) => {
      expect(machineServerInstallAction(facts)).toBe(action)
    }
  )
})
