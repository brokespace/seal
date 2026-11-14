import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import {
  LOCAL_MACHINE_ID,
  MACHINE_IPC,
  MACHINE_PREVIEW_MAX_BYTES,
  type MachineFileRead
} from '../../shared/machines/machine-types'
import {
  machineIdOf,
  requireString,
  requireStrings,
  type MachineInvokeHandler
} from './machine-ipc-args'
import {
  getMachineServices as getServices,
  invalidateMachineParentDir as invalidateParent,
  onMachineDirChanged,
  onMachineTransferUpdated,
  removeMachinePaths,
  resolveMachineFileSystem as resolveFileSystem,
  setMachineAccess
} from './machine-services'
import { getMachineRegistry } from './registry/machine-registry-service'
import { registerMachineRegistryHandlers } from './registry/machine-registry-ipc'
import { registerMachineShellHandlers } from './shell/machine-shell-ipc'
import { registerMachineWorkHandlers } from './work/machine-work-ipc'
import { registerAgentConfigHandlers } from '../agent-config/agent-config-ipc'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function handle(channel: string, handler: MachineInvokeHandler): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (event, args: unknown) => {
    assertTrustedSender(event)
    return handler(isRecord(args) ? args : {}, event)
  })
}

export function registerMachineHandlers(getMainWindow: () => BrowserWindow | null): void {
  currentGetMainWindow = getMainWindow
  setMachineAccess({
    views: () => getMachineRegistry().list(),
    connection: (machineId) => getMachineRegistry().connection(machineId),
    liveSessionSources: () => getMachineRegistry().liveSessionSources()
  })
  unsubscribeRendererEvents?.()
  const offDirs = onMachineDirChanged((event) => sendToRenderer(MACHINE_IPC.dirChanged, event))
  const offTransfers = onMachineTransferUpdated((transfer) =>
    sendToRenderer(MACHINE_IPC.transferUpdated, transfer)
  )
  unsubscribeRendererEvents = () => {
    offDirs()
    offTransfers()
  }
  ipcMain.removeAllListeners(MACHINE_IPC.startDrag)
  registerMachineRegistryHandlers(handle)
  registerMachineShellHandlers(handle, (channel, payload) => sendToRenderer(channel, payload))
  registerMachineWorkHandlers(handle)
  registerAgentConfigHandlers(handle, invalidateParent)

  handle(MACHINE_IPC.getMetrics, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const metrics = await getMachineRegistry().connection(machineId).metrics()
    void getMachineRegistry().probeIdentity(machineId)
    return metrics
  })

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
    machineId === LOCAL_MACHINE_ID ? path : await getServices().dragOut.stage(machineId, path, size)
  if (args.prepare === true || event.sender.isDestroyed()) {
    return
  }
  const icon = await app.getFileIcon(local, { size: 'normal' })
  event.sender.startDrag({ file: local, icon })
}
