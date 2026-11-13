// The assistant's view of a machine. seal/machines can replace the default provider without touching tools.

/** How scripts run on the machine: a POSIX shell, or PowerShell on Windows. */
export type HomeChatShellDialect = 'posix' | 'powershell'

export type HomeChatMachineInfo = {
  /** `local`, `ssh:<target-id>` (the spelling `orca --host` takes), or `hop:<name>`. */
  id: string
  label: string
  kind: 'local' | 'ssh' | 'hop'
  /** user@host:port for SSH machines. */
  address?: string
  /** How Seal reaches it when not directly: a ProxyJump/ProxyCommand or another machine's id. */
  via?: string
  connected: boolean
  platform?: string
  /** The user's or assistant's notes about this machine (user, shell quirks, what runs there). */
  notes?: string
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
  /** Piped to the script's stdin, then EOF. */
  stdin?: string | Buffer
}

export type HomeChatMachine = {
  readonly info: HomeChatMachineInfo
  readonly dialect: HomeChatShellDialect
  /** Run a script; quoting is the machine's job, so any text is safe to pass. */
  exec: (script: string, options: HomeChatExecOptions) => Promise<HomeChatExecResult>
  readTextFile: (path: string, maxBytes: number) => Promise<{ text: string; truncated: boolean }>
  writeTextFile: (path: string, content: string, options: { append: boolean }) => Promise<void>
  /** Stream a file on this machine to a path on the local machine. */
  downloadTo: (remotePath: string, localPath: string) => Promise<void>
  /** Stream a local file to a path on this machine. */
  uploadFrom: (localPath: string, remotePath: string) => Promise<void>
  probeLoad: () => Promise<HomeChatMachineLoad>
}

export type HomeChatMachineProvider = {
  list: () => Promise<HomeChatMachineInfo[]>
  /** Resolve by id, `ssh:` id, or label (case-insensitive); connects SSH machines on demand. */
  open: (machine: string) => Promise<HomeChatMachine>
}

export const LOCAL_MACHINE_ID = 'local'
