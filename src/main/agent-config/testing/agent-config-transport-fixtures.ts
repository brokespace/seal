import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { MachineConnection } from '../../machines/connection/machine-connection'
import { ServerMachineConnection } from '../../machines/connection/server-machine-connection'
import { SshMachineConnection } from '../../machines/connection/ssh-machine-connection'
import {
  createInProcessRuntimeChannel,
  createLoopbackSshLink
} from '../../machines/testing/machine-transport-test-doubles'
import { writeFixtureHome } from './agent-config-fixture-trees'

function sshConnection(): MachineConnection {
  const link = createLoopbackSshLink()
  return new SshMachineConnection('machine:loop-ssh', {
    link: () => link,
    connect: async () => {},
    openSystemShell: () => Promise.reject(new Error('agent configuration opens no shell'))
  })
}

function serverConnection(): MachineConnection {
  return new ServerMachineConnection('machine:loop-server', {
    channel: createInProcessRuntimeChannel().channel,
    isConnected: () => true,
    connect: async () => {}
  })
}

/** Both ways a machine is reached; each must give the same answers for the same home folder. */
export const AGENT_CONFIG_TRANSPORTS: [string, () => MachineConnection][] = [
  ['SSH', sshConnection],
  ['Seal server', serverConnection]
]

export type FixtureMachine = {
  home: string
  project: string
  connection: MachineConnection
  dispose: () => Promise<void>
}

/** A fresh fixture home that this process's "remote" shells and file calls land in. */
export async function openFixtureMachine(open: () => MachineConnection): Promise<FixtureMachine> {
  const saved = { HOME: process.env.HOME, SHELL: process.env.SHELL, PATH: process.env.PATH }
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seal-agent-config-')))
  process.env.HOME = home
  process.env.SHELL = '/bin/sh'
  // A test's own agent CLI stand-ins go in ~/bin, ahead of everything else.
  process.env.PATH = `${path.join(home, 'bin')}${path.delimiter}${saved.PATH ?? ''}`
  const { project } = await writeFixtureHome(home)
  const connection = open()
  await connection.connect()
  return {
    home,
    project,
    connection,
    dispose: async () => {
      process.env.HOME = saved.HOME
      process.env.SHELL = saved.SHELL
      process.env.PATH = saved.PATH
      await rm(home, { recursive: true, force: true })
    }
  }
}
