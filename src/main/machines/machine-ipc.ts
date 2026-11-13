import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { parseExecutionHostId } from '../../shared/execution-host'
import {
  MACHINE_IPC,
  MACHINE_PREVIEW_MAX_BYTES,
  type MachineFileRead,
  type MachineId
} from '../../shared/machines/machine-types'
import { collectMachineMetrics } from './metrics/machine-metrics'
import {
  getMachineServices as getServices,
  invalidateMachineParentDir as invalidateParent,
  onMachineDirChanged,
  onMachineTransferUpdated,
  removeMachinePaths,
  resolveMachineFileSystem as resolveFileSystem,
  resolveRuntimeMachineFileSystem as resolveRuntimeFileSystem
} from './machine-services'

const INVOKE_CHANNELS = [
  MACHINE_IPC.getMetrics,
  MACHINE_IPC.listDir,
  MACHINE_IPC.watchDirs,
  MACHINE_IPC.readFile,
  MACHINE_IPC.writeFile,
  MACHINE_IPC.createDir,
  MACHINE_IPC.rename,
  MACHINE_IPC.remove,
  MACHINE_IPC.upload,
  MACHINE_IPC.download,
  MACHINE_IPC.downloadUrl,
  MACHINE_IPC.cancelTransfer,
  MACHINE_IPC.listTransfers,
  MACHINE_IPC.clearFinishedTransfers
] as const

let currentGetMainWindow: () => BrowserWindow | null = () => null
let unsubscribeRendererEvents: (() => void) | null = null

function sendToRenderer(channel: string, payload: unknown): void {
  const window = currentGetMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, payload)
  }
}

/** Machine file access is a desktop-window capability; guests and plugin frames never get it. */
function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const window = currentGetMainWindow()
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Machine access is only available to the main window')
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

function requireStrings(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v): v is string => typeof v === 'string' && v !== '')
  ) {
    throw new Error(`${name} is required`)
  }
  return value
}

function machineIdOf(value: unknown): MachineId {
  const parsed = parseExecutionHostId(requireString(value, 'machineId'))
  if (!parsed) {
    throw new Error('Unknown machine')
  }
  return parsed.id
}

type Handler = (args: Record<string, unknown>) => unknown

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, (event, args: unknown) => {
    assertTrustedSender(event)
    return handler(isRecord(args) ? args : {})
  })
}

export function registerMachineHandlers(getMainWindow: () => BrowserWindow | null): void {
  currentGetMainWindow = getMainWindow
  unsubscribeRendererEvents?.()
  const offDirs = onMachineDirChanged((event) => sendToRenderer(MACHINE_IPC.dirChanged, event))
  const offTransfers = onMachineTransferUpdated((transfer) =>
    sendToRenderer(MACHINE_IPC.transferUpdated, transfer)
  )
  unsubscribeRendererEvents = () => {
    offDirs()
    offTransfers()
  }
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.removeAllListeners(MACHINE_IPC.startDrag)

  handle(MACHINE_IPC.getMetrics, (args) =>
    collectMachineMetrics(machineIdOf(args.machineId), resolveRuntimeFileSystem)
  )

  handle(MACHINE_IPC.listDir, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const path =
      typeof args.path === 'string' && args.path
        ? args.path
        : await resolveFileSystem(machineId).homeDir()
    return getServices().directories.listDir(machineId, path, {
      force: args.force === true,
      offset: typeof args.offset === 'number' ? args.offset : 0
    })
  })

  handle(MACHINE_IPC.watchDirs, (args) => {
    const dirs = Array.isArray(args.dirs)
      ? args.dirs.filter((d): d is string => typeof d === 'string')
      : []
    return getServices().directories.watchDirs(machineIdOf(args.machineId), dirs)
  })

  handle(MACHINE_IPC.readFile, async (args): Promise<MachineFileRead> => {
    const path = requireString(args.path, 'path')
    const requested = typeof args.maxBytes === 'number' ? args.maxBytes : MACHINE_PREVIEW_MAX_BYTES
    const maxBytes = Math.max(0, Math.min(requested, MACHINE_PREVIEW_MAX_BYTES))
    const { size, data } = await resolveFileSystem(machineIdOf(args.machineId)).readFile(
      path,
      maxBytes
    )
    return { path, size, contentBase64: data.toString('base64'), truncated: size > data.length }
  })

  handle(MACHINE_IPC.writeFile, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const path = requireString(args.path, 'path')
    if (typeof args.content !== 'string') {
      throw new Error('content is required')
    }
    await resolveFileSystem(machineId).writeFile(path, Buffer.from(args.content, 'utf8'))
    invalidateParent(machineId, path)
  })

  handle(MACHINE_IPC.createDir, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const path = requireString(args.path, 'path')
    await resolveFileSystem(machineId).createDir(path)
    invalidateParent(machineId, path)
  })

  handle(MACHINE_IPC.rename, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const from = requireString(args.from, 'from')
    const to = requireString(args.to, 'to')
    await resolveFileSystem(machineId).rename(from, to)
    invalidateParent(machineId, from)
    invalidateParent(machineId, to)
  })

  handle(MACHINE_IPC.remove, (args) =>
    removeMachinePaths(machineIdOf(args.machineId), requireStrings(args.paths, 'paths'))
  )

  handle(MACHINE_IPC.upload, (args) =>
    getServices().transfers.upload(
      machineIdOf(args.machineId),
      requireStrings(args.localPaths, 'localPaths'),
      requireString(args.destDir, 'destDir')
    )
  )

  handle(MACHINE_IPC.download, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const remotePaths = requireStrings(args.paths, 'paths')
    const window = currentGetMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Download to…',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const localDir = result.canceled ? null : result.filePaths[0]
    return localDir ? getServices().transfers.download(machineId, remotePaths, localDir) : null
  })

  handle(MACHINE_IPC.downloadUrl, (args) =>
    getServices().transfers.downloadUrl(
      machineIdOf(args.machineId),
      requireString(args.url, 'url'),
      requireString(args.destDir, 'destDir'),
      typeof args.fileName === 'string' ? args.fileName : undefined
    )
  )

  handle(MACHINE_IPC.cancelTransfer, (args) => {
    getServices().transfers.cancel(requireString(args.transferId, 'transferId'))
  })

  handle(MACHINE_IPC.listTransfers, () => getServices().transfers.list())

  handle(MACHINE_IPC.clearFinishedTransfers, () => {
    getServices().transfers.clearFinished()
  })

  // `prepare: true` stages a remote file on pointer-down; the later drag then starts instantly.
  ipcMain.on(MACHINE_IPC.startDrag, (event, args: Record<string, unknown> | undefined) => {
    try {
      assertTrustedSender(event)
    } catch {
      return
    }
    void startDrag(event, args ?? {}).catch((error: unknown) => {
      console.warn('[machines] drag-out failed:', error instanceof Error ? error.message : error)
    })
  })
}

async function startDrag(event: IpcMainEvent, args: Record<string, unknown>): Promise<void> {
  const machineId = machineIdOf(args.machineId)
  const path = requireString(args.path, 'path')
  const size = typeof args.size === 'number' ? args.size : 0
  const local =
    parseExecutionHostId(machineId)?.kind === 'local'
      ? path
      : await getServices().dragOut.stage(machineId, path, size)
  if (args.prepare === true || event.sender.isDestroyed()) {
    return
  }
  const icon = await app.getFileIcon(local, { size: 'normal' })
  event.sender.startDrag({ file: local, icon })
}
