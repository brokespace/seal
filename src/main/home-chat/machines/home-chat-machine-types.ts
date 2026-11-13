// The assistant's view of a machine. seal/machines can replace the default provider without touching tools.

export type HomeChatMachineInfo = {
  /** `local` or `ssh:<target-id>`, the same host spelling `orca --host` takes. */
  id: string
  label: string
  kind: 'local' | 'ssh'
  /** user@host:port for SSH machines. */
  address?: string
  connected: boolean
  platform?: string
}

export type HomeChatMachineLoad = {
  cpuCount: number | null
  /** 1-minute load average; null when the machine cannot report it. */
  loadAverage1m: number | null
}

export type HomeChatExecResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type HomeChatExecOptions = {
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
}

export type HomeChatMachine = {
  readonly info: HomeChatMachineInfo
  exec: (command: string, options: HomeChatExecOptions) => Promise<HomeChatExecResult>
  readTextFile: (path: string, maxBytes: number) => Promise<{ text: string; truncated: boolean }>
  writeTextFile: (path: string, content: string, options: { append: boolean }) => Promise<void>
  /** Copy a file on this machine to a path on the local machine. */
  downloadTo: (remotePath: string, localPath: string) => Promise<void>
  /** Copy a local file to a path on this machine. */
  uploadFrom: (localPath: string, remotePath: string) => Promise<void>
  probeLoad: () => Promise<HomeChatMachineLoad>
}

export type HomeChatMachineProvider = {
  list: () => Promise<HomeChatMachineInfo[]>
  /** Resolve by id, `ssh:` id, or label (case-insensitive); connects SSH machines on demand. */
  open: (machine: string) => Promise<HomeChatMachine>
}

export const LOCAL_MACHINE_ID = 'local'
