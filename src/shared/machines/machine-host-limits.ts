/** Entries per `machineHost.listDir` page; keeps one reply far below the 8 MiB runtime frame cap. */
export const MACHINE_HOST_LIST_PAGE_MAX = 5_000

/** Raw bytes per `machineHost.readChunk` reply (base64 ~1.4 MiB on the wire). */
export const MACHINE_HOST_READ_CHUNK_MAX_BYTES = 1024 * 1024

/** Raw bytes per write request; matches the established 512 KiB base64 upload slice. */
export const MACHINE_HOST_WRITE_CHUNK_MAX_BYTES = 384 * 1024

export const MACHINE_HOST_WRITE_CHUNK_MAX_BASE64_CHARS =
  Math.ceil(MACHINE_HOST_WRITE_CHUNK_MAX_BYTES / 3) * 4

export const MACHINE_HOST_WATCH_MAX_DIRS = 256

/** Streams this feature owns; `machineHost.cancel` refuses any other subscription id. */
export const MACHINE_HOST_SUBSCRIPTION_PREFIX = 'machine-host-'

export const MACHINE_HOST_EXEC_MAX_SCRIPT_CHARS = 1024 * 1024

export const MACHINE_HOST_EXEC_MAX_STDIN_BASE64_CHARS = 2 * 1024 * 1024

export const MACHINE_HOST_EXEC_MAX_TIMEOUT_MS = 60 * 60 * 1000

/** Per stream (stdout, stderr); two of them stay far below the 8 MiB runtime frame cap. */
export const MACHINE_HOST_EXEC_MAX_OUTPUT_BYTES = 1024 * 1024
