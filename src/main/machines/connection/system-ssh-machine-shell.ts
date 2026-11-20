import { homedir } from 'node:os'
import type { SshTarget } from '../../../shared/ssh-types'
import { mayUserSshConfigClaimAlias } from '../../ssh/config/ssh-config-alias-claim'
import { buildPlainSshTerminalArgs } from '../../ssh/plain-ssh-terminal/plain-ssh-terminal-args'
import { findSystemSsh } from '../../ssh/system-transport/system-ssh-binary'
import { openLocalPty } from './local-machine-shell'
import type { MachineShell, MachineShellHandlers, MachineShellOptions } from './machine-connection'

/** System-ssh hosts (agent/ProxyCommand auth) have no ssh2 channel, so the ssh binary runs in a local PTY. */
export async function openSystemSshMachineShell(
  target: SshTarget,
  prelude: string | null,
  options: MachineShellOptions,
  handlers: MachineShellHandlers
): Promise<MachineShell> {
  const sshPath = findSystemSsh()
  if (!sshPath) {
    throw new Error('Install an OpenSSH client to open terminals on this machine')
  }
  const args = [
    '-t',
    ...buildPlainSshTerminalArgs(
      target,
      target.configHost && !mayUserSshConfigClaimAlias(target.configHost)
        ? { aliasClaimedByConfig: false }
        : undefined
    )
  ]
  const shell = await openLocalPty({ file: sshPath, args, cwd: homedir() }, options, handlers)
  if (prelude) {
    shell.write(`${prelude}\n`)
  }
  return shell
}
