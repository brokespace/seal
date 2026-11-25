import * as z from 'zod'
import {
  MACHINE_HOST_EXEC_MAX_SCRIPT_CHARS,
  MACHINE_HOST_EXEC_MAX_STDIN_BASE64_CHARS,
  MACHINE_HOST_EXEC_MAX_TIMEOUT_MS,
  MACHINE_HOST_LIST_PAGE_MAX,
  MACHINE_HOST_READ_CHUNK_MAX_BYTES,
  MACHINE_HOST_WATCH_MAX_DIRS,
  MACHINE_HOST_WRITE_CHUNK_MAX_BASE64_CHARS
} from '../machines/machine-host-limits'

const HostPath = z.string().min(1).max(4096)
const ByteOffset = z.number().int().min(0)
const ChunkBase64 = z.string().max(MACHINE_HOST_WRITE_CHUNK_MAX_BASE64_CHARS)

export const MachineHostPath = z.object({ path: HostPath })

export const MachineHostListDir = z.object({
  path: HostPath,
  offset: ByteOffset,
  limit: z.number().int().min(1).max(MACHINE_HOST_LIST_PAGE_MAX)
})

export const MachineHostReadChunk = z.object({
  path: HostPath,
  offset: ByteOffset,
  length: z.number().int().min(1).max(MACHINE_HOST_READ_CHUNK_MAX_BYTES)
})

/** Creates or truncates `path` with the first slice; later slices use `machineHost.writeChunk`. */
export const MachineHostCreateFile = z.object({ path: HostPath, contentBase64: ChunkBase64 })

export const MachineHostWriteChunk = z.object({
  path: HostPath,
  offset: ByteOffset,
  contentBase64: ChunkBase64
})

export const MachineHostRename = z.object({ from: HostPath, to: HostPath })

export const MachineHostDownloadUrl = z.object({
  url: z.string().min(1).max(8192),
  destination: HostPath
})

export const MachineHostWatch = z.object({
  dirs: z.array(HostPath).min(1).max(MACHINE_HOST_WATCH_MAX_DIRS)
})

/** Runs in the host's login shell as the paired user, the same reach a terminal there has. */
export const MachineHostExec = z.object({
  script: z.string().min(1).max(MACHINE_HOST_EXEC_MAX_SCRIPT_CHARS),
  cwd: HostPath.optional(),
  timeoutMs: z.number().int().min(1_000).max(MACHINE_HOST_EXEC_MAX_TIMEOUT_MS),
  stdinBase64: z.string().max(MACHINE_HOST_EXEC_MAX_STDIN_BASE64_CHARS).optional()
})

export const MachineHostCancel = z.object({ subscriptionId: z.string().min(1).max(256) })

const TerminalSize = z.number().int().min(1).max(1000)

/** `command` runs in the login shell instead of an interactive prompt (agents launch this way). */
export const MachineHostShell = z.object({
  cols: TerminalSize,
  rows: TerminalSize,
  cwd: HostPath.optional(),
  command: z
    .string()
    .min(1)
    .max(64 * 1024)
    .optional()
})

export const MachineHostShellInput = z.object({
  subscriptionId: z.string().min(1).max(256),
  dataBase64: z.string().max(1024 * 1024)
})

export const MachineHostShellResize = z.object({
  subscriptionId: z.string().min(1).max(256),
  cols: TerminalSize,
  rows: TerminalSize
})
