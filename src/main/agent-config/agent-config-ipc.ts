import {
  AGENT_CONFIG_IPC,
  type AgentConfigMcpActivation,
  type AgentConfigTarget
} from '../../shared/agent-config/agent-config-types'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import type { MachineConnection } from '../machines/connection/machine-connection'
import {
  machineIdOf,
  requireString,
  requireStrings,
  type MachineInvokeRegistrar
} from '../machines/machine-ipc-args'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import {
  copyDocument,
  createDocument,
  deleteDocument,
  duplicateDocument,
  renameDocument
} from './agent-config-documents'
import {
  DOC_KINDS,
  draftOf,
  editsOf,
  pluginCommandOf,
  refOf,
  scopeOf,
  targetOf,
  validationKindOf
} from './agent-config-ipc-args'
import { testMcpServer } from './agent-config-mcp-probe'
import {
  listMachineBackups,
  readManagedDocument,
  removeManagedPaths,
  renameManagedPath,
  restoreMachineBackup,
  saveManagedDocument
} from './agent-config-managed-files'
import { runPluginCommand, setPluginEnabled } from './agent-config-plugin-commands'
import {
  copyMcpServer,
  patchSettings,
  removeMcpServer,
  revealMcpServer,
  saveMcpServer,
  setMcpActivation
} from './agent-config-settings-ops'
import { detectAgentConfigAgents } from './agent-config-agent-detection'
import { buildAgentConfigSnapshot } from './agent-config-snapshot'

type Args = Record<string, unknown>

async function connected(machineId: unknown): Promise<MachineConnection> {
  const connection = getMachineRegistry().connection(machineIdOf(machineId))
  await connection.connect()
  return connection
}

async function forTarget(
  value: unknown
): Promise<{ connection: MachineConnection; target: AgentConfigTarget }> {
  const target = targetOf(value)
  return { connection: await connected(target.machineId), target }
}

/** `onChanged` lets the file browser drop what it cached for a folder Seal just wrote to. */
export function registerAgentConfigHandlers(
  handle: MachineInvokeRegistrar,
  onChanged: (machineId: AgentConfigTarget['machineId'], path: string) => void
): void {
  const changing = (
    channel: string,
    run: (
      args: Args
    ) => Promise<{ machineId: AgentConfigTarget['machineId']; result: unknown; paths?: string[] }>
  ): void =>
    handle(channel, async (args) => {
      const { machineId, result, paths } = await run(args)
      const written = isPlainObject(result) && typeof result.path === 'string' ? [result.path] : []
      for (const path of paths ?? written) {
        onChanged(machineId, path)
      }
      return result
    })

  handle(AGENT_CONFIG_IPC.agents, async (args) =>
    detectAgentConfigAgents(
      await connected(args.machineId),
      typeof args.projectPath === 'string' && args.projectPath ? args.projectPath : undefined
    )
  )
  handle(AGENT_CONFIG_IPC.snapshot, async (args) => {
    const { connection, target } = await forTarget(args.target)
    return buildAgentConfigSnapshot(connection, target)
  })
  handle(AGENT_CONFIG_IPC.readDocument, async (args) => {
    const { connection, target } = await forTarget(args.target)
    return readManagedDocument(connection, target, requireString(args.path, 'path'))
  })
  changing(AGENT_CONFIG_IPC.saveDocument, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const validation = validationKindOf(args.validation)
    const result = await saveManagedDocument(connection, target, {
      path: requireString(args.path, 'path'),
      content: typeof args.content === 'string' ? args.content : '',
      ...(typeof args.expectedHash === 'string' ? { expectedHash: args.expectedHash } : {}),
      ...(validation ? { validation } : {}),
      ...(typeof args.expectedName === 'string' ? { expectedName: args.expectedName } : {})
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.createDocument, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const kind = DOC_KINDS.find((candidate) => candidate === args.kind)
    if (!kind) {
      throw new Error('Unknown document kind')
    }
    const result = await createDocument(connection, {
      target,
      kind,
      scope: scopeOf(args.scope),
      name: requireString(args.name, 'name'),
      ...(typeof args.collectionDir === 'string' ? { collectionDir: args.collectionDir } : {})
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.duplicateDocument, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const result = await duplicateDocument(connection, {
      target,
      ref: refOf(args.ref),
      newName: requireString(args.newName, 'newName')
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.renameDocument, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const ref = refOf(args.ref)
    const result = await renameDocument(connection, {
      target,
      ref,
      newName: requireString(args.newName, 'newName')
    })
    return { machineId: target.machineId, result, paths: [ref.path, result.path] }
  })
  changing(AGENT_CONFIG_IPC.deleteDocument, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const ref = refOf(args.ref)
    const result = await deleteDocument(connection, { target, ref })
    return { machineId: target.machineId, result, paths: [ref.path] }
  })
  changing(AGENT_CONFIG_IPC.copyDocument, async (args) => {
    const from = await forTarget(args.target)
    const to = await forTarget(args.to)
    const result = await copyDocument(from.connection, to.connection, {
      target: from.target,
      ref: refOf(args.ref),
      to: to.target,
      toScope: scopeOf(args.toScope),
      overwrite: args.overwrite === true
    })
    return { machineId: to.target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.saveMcpServer, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const result = await saveMcpServer(connection, {
      target,
      scope: scopeOf(args.scope),
      ...(typeof args.originalName === 'string' ? { originalName: args.originalName } : {}),
      draft: draftOf(args.draft)
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.removeMcpServer, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const result = await removeMcpServer(connection, {
      target,
      scope: scopeOf(args.scope),
      name: requireString(args.name, 'name')
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.copyMcpServer, async (args) => {
    const from = await forTarget(args.target)
    const to = await forTarget(args.to)
    const result = await copyMcpServer(from.connection, to.connection, {
      target: from.target,
      scope: scopeOf(args.scope),
      name: requireString(args.name, 'name'),
      to: to.target,
      toScope: scopeOf(args.toScope),
      overwrite: args.overwrite === true
    })
    return { machineId: to.target.machineId, result }
  })
  handle(AGENT_CONFIG_IPC.revealMcpServer, async (args) => {
    const { connection, target } = await forTarget(args.target)
    return revealMcpServer(connection, {
      target,
      scope: scopeOf(args.scope),
      name: requireString(args.name, 'name')
    })
  })
  handle(AGENT_CONFIG_IPC.testMcpServer, async (args) => {
    const { connection, target } = await forTarget(args.target)
    return testMcpServer(connection, {
      target,
      scope: scopeOf(args.scope),
      name: requireString(args.name, 'name')
    })
  })
  changing(AGENT_CONFIG_IPC.setMcpActivation, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const activation = (['approved', 'disabled', 'pending'] as const).find(
      (candidate): candidate is AgentConfigMcpActivation => candidate === args.activation
    )
    if (!activation) {
      throw new Error('Unknown choice')
    }
    const result = await setMcpActivation(connection, {
      target,
      name: requireString(args.name, 'name'),
      activation
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.patchSettings, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const result = await patchSettings(connection, {
      target,
      scope: scopeOf(args.scope),
      edits: editsOf(args.edits)
    })
    return { machineId: target.machineId, result }
  })
  changing(AGENT_CONFIG_IPC.setPluginEnabled, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const result = await setPluginEnabled(connection, {
      target,
      scope: scopeOf(args.scope),
      plugin: requireString(args.plugin, 'plugin'),
      enabled: typeof args.enabled === 'boolean' ? args.enabled : null
    })
    return { machineId: target.machineId, result }
  })
  handle(AGENT_CONFIG_IPC.runPluginCommand, async (args) => {
    const { connection, target } = await forTarget(args.target)
    return runPluginCommand(connection, { target, command: pluginCommandOf(args.command) })
  })
  handle(AGENT_CONFIG_IPC.listBackups, async (args) =>
    listMachineBackups(await connected(args.machineId))
  )
  changing(AGENT_CONFIG_IPC.restoreBackup, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const result = await restoreMachineBackup(
      await connected(machineId),
      requireString(args.backupPath, 'backupPath')
    )
    return { machineId, result }
  })
  changing(AGENT_CONFIG_IPC.removePaths, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const paths = requireStrings(args.paths, 'paths')
    const result = await removeManagedPaths(connection, target, paths)
    return { machineId: target.machineId, result, paths }
  })
  changing(AGENT_CONFIG_IPC.renamePath, async (args) => {
    const { connection, target } = await forTarget(args.target)
    const from = requireString(args.from, 'from')
    const to = requireString(args.to, 'to')
    await renameManagedPath(connection, target, from, to)
    return { machineId: target.machineId, result: undefined, paths: [from, to] }
  })
}
