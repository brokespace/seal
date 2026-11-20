import { homedir } from 'node:os'
import type * as pty from 'node-pty'
import {
  ensureNodePtySpawnHelperExecutable,
  spawnPtyExecutable
} from '../../providers/local-pty/local-pty-executable-spawn'
import { buildInheritedLocalPtyEnvironment } from '../../providers/local-pty/local-pty-spawn-environment'
import { destroyPtyProcess } from '../../providers/local-pty/local-pty-termination'
import type { MachineShell, MachineShellHandlers, MachineShellOptions } from './machine-connection'

export function machineShellLaunch(
  command: string | undefined,
  platform: NodeJS.Platform
): { file: string; args: string[] } {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: command ? ['-NoLogo', '-Command', command] : ['-NoLogo']
    }
  }
  const shell = process.env.SHELL || '/bin/bash'
  return { file: shell, args: command ? ['-lc', command] : ['-l'] }
}

/** Runs `file` in a PTY on this computer and adapts it to a machine shell. */
export async function openLocalPty(
  launch: { file: string; args: string[]; cwd: string },
  options: Pick<MachineShellOptions, 'cols' | 'rows'>,
  handlers: MachineShellHandlers
): Promise<MachineShell> {
  // Packaged macOS updates can lose the node-pty spawn-helper executable bit.
  ensureNodePtySpawnHelperExecutable()
  const { spawn } = await import('node-pty')
  const proc: pty.IPty = spawnPtyExecutable({
    file: launch.file,
    args: launch.args,
    cols: options.cols,
    rows: options.rows,
    cwd: launch.cwd,
    env: buildInheritedLocalPtyEnvironment(undefined),
    ptySpawn: spawn
  })
  let exited = false
  proc.onData((data) => handlers.onData(data))
  proc.onExit(({ exitCode }) => {
    exited = true
    destroyPtyProcess(proc, { alreadyKilled: true })
    handlers.onExit(exitCode)
  })
  return {
    write: (data) => {
      if (!exited) {
        proc.write(data)
      }
    },
    resize: (cols, rows) => {
      if (!exited) {
        proc.resize(cols, rows)
      }
    },
    close: () => {
      if (!exited) {
        destroyPtyProcess(proc)
      }
    }
  }
}

/** A login shell on this computer; the Seal server serves the same shell to the desktop. */
export function openShellOnThisMachine(
  options: MachineShellOptions,
  handlers: MachineShellHandlers
): Promise<MachineShell> {
  const { file, args } = machineShellLaunch(options.command, process.platform)
  return openLocalPty({ file, args, cwd: options.cwd ?? homedir() }, options, handlers)
}
