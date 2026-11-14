import { defineMethod, defineStreamingMethod } from '../../core'
import {
  MachineHostCancel,
  MachineHostCreateFile,
  MachineHostDownloadUrl,
  MachineHostExec,
  MachineHostListDir,
  MachineHostPath,
  MachineHostReadChunk,
  MachineHostRename,
  MachineHostShell,
  MachineHostShellInput,
  MachineHostShellResize,
  MachineHostWatch,
  MachineHostWriteChunk
} from '../../../../../shared/rpc-contract/machine-host-params'
import { MACHINE_HOST_EXEC_MAX_OUTPUT_BYTES } from '../../../../../shared/machines/machine-host-limits'
import { runLocalShellScript } from '../../../../machines/exec/local-shell-exec'
import { collectLocalMachineMetrics } from '../../../../machines/metrics/local-machine-metrics'
import {
  resizeMachineHostShell,
  runMachineHostShell,
  writeMachineHostShell
} from './machine-host-shell'
import {
  createHostFile,
  listHostDirPage,
  machineHostFileSystem,
  readHostChunk,
  removeHostPath,
  requireHostPath,
  writeHostChunk
} from './machine-host-file-io'
import {
  cancelMachineHostStream,
  runMachineHostUrlDownload,
  runMachineHostWatch
} from './machine-host-streams'

// Whole-disk access for the desktop Machines tab: 'workspace' already equals running commands as this user.
export const MACHINE_HOST_METHODS = [
  defineMethod({
    name: 'machineHost.metrics',
    permission: 'workspace',
    params: null,
    handler: async () => collectLocalMachineMetrics()
  }),
  defineMethod({
    name: 'machineHost.homeDir',
    permission: 'workspace',
    params: null,
    handler: async () => ({ path: await machineHostFileSystem.homeDir() })
  }),
  defineMethod({
    name: 'machineHost.listDir',
    permission: 'workspace',
    params: MachineHostListDir,
    handler: async (params) => listHostDirPage(params.path, params.offset, params.limit)
  }),
  defineMethod({
    name: 'machineHost.stat',
    permission: 'workspace',
    params: MachineHostPath,
    handler: async (params) => machineHostFileSystem.stat(requireHostPath(params.path))
  }),
  defineMethod({
    name: 'machineHost.readChunk',
    permission: 'workspace',
    params: MachineHostReadChunk,
    handler: async (params) => readHostChunk(params.path, params.offset, params.length)
  }),
  defineMethod({
    name: 'machineHost.createFile',
    permission: 'workspace',
    params: MachineHostCreateFile,
    handler: async (params) => {
      await createHostFile(params.path, params.contentBase64)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'machineHost.writeChunk',
    permission: 'workspace',
    params: MachineHostWriteChunk,
    handler: async (params) => {
      await writeHostChunk(params.path, params.offset, params.contentBase64)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'machineHost.createDir',
    permission: 'workspace',
    params: MachineHostPath,
    handler: async (params) => {
      await machineHostFileSystem.createDir(requireHostPath(params.path))
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'machineHost.rename',
    permission: 'workspace',
    params: MachineHostRename,
    handler: async (params) => {
      await machineHostFileSystem.rename(requireHostPath(params.from), requireHostPath(params.to))
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'machineHost.remove',
    permission: 'workspace',
    params: MachineHostPath,
    handler: async (params) => {
      await removeHostPath(params.path)
      return { ok: true }
    }
  }),
  defineStreamingMethod({
    name: 'machineHost.watch',
    permission: 'workspace',
    params: MachineHostWatch,
    handler: async (params, ctx, emit) => runMachineHostWatch(params.dirs, ctx, emit)
  }),
  defineStreamingMethod({
    name: 'machineHost.downloadUrl',
    permission: 'workspace',
    params: MachineHostDownloadUrl,
    handler: async (params, ctx, emit) =>
      runMachineHostUrlDownload(params.url, params.destination, ctx, emit)
  }),
  defineMethod({
    name: 'machineHost.exec',
    permission: 'workspace',
    params: MachineHostExec,
    handler: async (params) =>
      runLocalShellScript(params.script, {
        timeoutMs: params.timeoutMs,
        maxOutputBytes: MACHINE_HOST_EXEC_MAX_OUTPUT_BYTES,
        ...(params.cwd ? { cwd: requireHostPath(params.cwd) } : {}),
        ...(params.stdinBase64 !== undefined
          ? { stdin: Buffer.from(params.stdinBase64, 'base64') }
          : {})
      })
  }),
  defineStreamingMethod({
    name: 'machineHost.shell',
    permission: 'workspace',
    params: MachineHostShell,
    handler: async (params, ctx, emit) =>
      runMachineHostShell(
        { ...params, ...(params.cwd ? { cwd: requireHostPath(params.cwd) } : {}) },
        ctx,
        emit
      )
  }),
  defineMethod({
    name: 'machineHost.shellInput',
    permission: 'workspace',
    params: MachineHostShellInput,
    handler: async (params) => writeMachineHostShell(params.subscriptionId, params.dataBase64)
  }),
  defineMethod({
    name: 'machineHost.shellResize',
    permission: 'workspace',
    params: MachineHostShellResize,
    handler: async (params) =>
      resizeMachineHostShell(params.subscriptionId, params.cols, params.rows)
  }),
  defineMethod({
    name: 'machineHost.cancel',
    permission: 'workspace',
    params: MachineHostCancel,
    handler: async (params, { runtime }) => cancelMachineHostStream(runtime, params.subscriptionId)
  })
]
