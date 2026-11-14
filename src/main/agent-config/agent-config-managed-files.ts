import type {
  AgentConfigBackup,
  AgentConfigDocument,
  AgentConfigTarget,
  AgentConfigValidationKind,
  AgentConfigWriteResult
} from '../../shared/agent-config/agent-config-types'
import { machinePathDirname } from '../../shared/machines/machine-paths'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { backupStamp, findBackup, listBackups, moveToBackups } from './agent-config-backups'
import { pathStates, readConfigFile, writeConfigFile } from './agent-config-file-io'
import { assertManagedPath, resolveTarget } from './agent-config-locations'
import { copyMachineTree } from './agent-config-tree-copy'

async function managed(
  connection: MachineConnection,
  target: AgentConfigTarget,
  paths: readonly string[]
): Promise<string> {
  const resolved = resolveTarget(target, await connection.files.homeDir())
  for (const path of paths) {
    assertManagedPath(resolved, path)
  }
  return resolved.home
}

export async function readManagedDocument(
  connection: MachineConnection,
  target: AgentConfigTarget,
  path: string
): Promise<AgentConfigDocument> {
  await managed(connection, target, [path])
  const { content, hash, exists } = await readConfigFile(connection, path)
  return { path, content, hash, exists }
}

/** Saves any file of the agent's configuration: the raw editor and every markdown editor end here. */
export async function saveManagedDocument(
  connection: MachineConnection,
  target: AgentConfigTarget,
  args: {
    path: string
    content: string
    expectedHash?: string
    validation?: AgentConfigValidationKind
    expectedName?: string
  }
): Promise<AgentConfigWriteResult> {
  await managed(connection, target, [args.path])
  const { path, content, ...options } = args
  return writeConfigFile(connection, path, content, options)
}

/** Deleting from the raw file browser also goes to the backups folder. */
export async function removeManagedPaths(
  connection: MachineConnection,
  target: AgentConfigTarget,
  paths: readonly string[]
): Promise<{ backupPaths: string[] }> {
  const home = await managed(connection, target, paths)
  const stamp = backupStamp()
  const backupPaths: string[] = []
  for (const path of paths) {
    backupPaths.push(await moveToBackups(connection, home, path, stamp))
  }
  return { backupPaths }
}

export async function renameManagedPath(
  connection: MachineConnection,
  target: AgentConfigTarget,
  from: string,
  to: string
): Promise<void> {
  await managed(connection, target, [from, to])
  await connection.files.rename(from, to)
}

export async function listMachineBackups(
  connection: MachineConnection
): Promise<AgentConfigBackup[]> {
  return listBackups(connection, await connection.files.homeDir())
}

/** Puts a backup back where it came from; what is there now is backed up first. */
export async function restoreMachineBackup(
  connection: MachineConnection,
  backupPath: string
): Promise<AgentConfigWriteResult> {
  const home = await connection.files.homeDir()
  const backup = await findBackup(connection, home, backupPath)
  if (!backup.isDirectory) {
    const { content, exists } = await readConfigFile(connection, backup.backupPath)
    if (!exists) {
      throw new Error('The backup file is gone from the machine')
    }
    return writeConfigFile(connection, backup.originalPath, content)
  }
  const { states } = await pathStates(connection, [backup.backupPath, backup.originalPath])
  if (states.get(backup.backupPath) !== 'directory') {
    throw new Error('The backup folder is gone from the machine')
  }
  const displaced =
    states.get(backup.originalPath) === 'missing'
      ? null
      : await moveToBackups(connection, home, backup.originalPath, backupStamp())
  const parent = machinePathDirname(backup.originalPath)
  if (parent) {
    await connection.files.createDir(parent)
  }
  await copyMachineTree(connection, backup.backupPath, connection, backup.originalPath)
  return { path: backup.originalPath, hash: '', backupPath: displaced }
}
