import { ipcRenderer } from 'electron'
import {
  AGENT_CONFIG_IPC,
  type AgentConfigAgentPresence,
  type AgentConfigBackup,
  type AgentConfigCommandResult,
  type AgentConfigCopyResult,
  type AgentConfigDocKind,
  type AgentConfigDocument,
  type AgentConfigMcpActivation,
  type AgentConfigMcpDraft,
  type AgentConfigMcpServer,
  type AgentConfigMcpTestResult,
  type AgentConfigPluginCommand,
  type AgentConfigScope,
  type AgentConfigSettingsEdit,
  type AgentConfigSnapshot,
  type AgentConfigTarget,
  type AgentConfigValidationKind,
  type AgentConfigWriteResult
} from '../../../shared/agent-config/agent-config-types'
import type { MachineId } from '../../../shared/machines/machine-types'

type DocRef = { kind: AgentConfigDocKind; scope: AgentConfigScope; path: string }

export type AgentConfigApi = {
  agents: (args: {
    machineId: MachineId
    projectPath?: string
  }) => Promise<AgentConfigAgentPresence[]>
  snapshot: (args: { target: AgentConfigTarget }) => Promise<AgentConfigSnapshot>
  readDocument: (args: { target: AgentConfigTarget; path: string }) => Promise<AgentConfigDocument>
  /** Validated, conflict-checked against `expectedHash`, and backed up before it is written. */
  saveDocument: (args: {
    target: AgentConfigTarget
    path: string
    content: string
    expectedHash?: string
    validation?: AgentConfigValidationKind
    expectedName?: string
  }) => Promise<AgentConfigWriteResult>
  createDocument: (args: {
    target: AgentConfigTarget
    kind: AgentConfigDocKind
    scope: AgentConfigScope
    name: string
    collectionDir?: string
  }) => Promise<AgentConfigWriteResult>
  duplicateDocument: (args: {
    target: AgentConfigTarget
    ref: DocRef
    newName: string
  }) => Promise<AgentConfigWriteResult>
  renameDocument: (args: {
    target: AgentConfigTarget
    ref: DocRef
    newName: string
  }) => Promise<AgentConfigWriteResult>
  deleteDocument: (args: { target: AgentConfigTarget; ref: DocRef }) => Promise<{
    backupPath: string
  }>
  copyDocument: (args: {
    target: AgentConfigTarget
    ref: DocRef
    to: AgentConfigTarget
    toScope: AgentConfigScope
    overwrite?: boolean
  }) => Promise<AgentConfigCopyResult>
  saveMcpServer: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    originalName?: string
    draft: AgentConfigMcpDraft
  }) => Promise<AgentConfigWriteResult>
  removeMcpServer: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    name: string
  }) => Promise<AgentConfigWriteResult>
  copyMcpServer: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    name: string
    to: AgentConfigTarget
    toScope: AgentConfigScope
    overwrite?: boolean
  }) => Promise<AgentConfigWriteResult>
  /** The only call that returns stored secrets, for the one server being edited. */
  revealMcpServer: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    name: string
  }) => Promise<AgentConfigMcpServer>
  testMcpServer: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    name: string
  }) => Promise<AgentConfigMcpTestResult>
  setMcpActivation: (args: {
    target: AgentConfigTarget
    name: string
    activation: AgentConfigMcpActivation
  }) => Promise<AgentConfigWriteResult>
  patchSettings: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    edits: AgentConfigSettingsEdit[]
  }) => Promise<AgentConfigWriteResult>
  /** `enabled: null` removes this scope's say so a weaker scope decides. */
  setPluginEnabled: (args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    plugin: string
    enabled: boolean | null
  }) => Promise<AgentConfigWriteResult>
  runPluginCommand: (args: {
    target: AgentConfigTarget
    command: AgentConfigPluginCommand
  }) => Promise<AgentConfigCommandResult>
  listBackups: (args: { machineId: MachineId }) => Promise<AgentConfigBackup[]>
  restoreBackup: (args: {
    machineId: MachineId
    backupPath: string
  }) => Promise<AgentConfigWriteResult>
  /** Moves the paths into the backups folder. */
  removePaths: (args: { target: AgentConfigTarget; paths: string[] }) => Promise<{
    backupPaths: string[]
  }>
  renamePath: (args: { target: AgentConfigTarget; from: string; to: string }) => Promise<void>
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the channel map and the API type list the same names, and each channel takes that method's arguments.
export const agentConfigApi = Object.fromEntries(
  Object.entries(AGENT_CONFIG_IPC).map(([name, channel]) => [
    name,
    (args: unknown) => ipcRenderer.invoke(channel, args)
  ])
) as AgentConfigApi
