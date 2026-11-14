// The assistant's view of a machine: the same machines the Machines page lists, plus hops it defined itself.
import type { HomeChatMachineStatus } from '../../../shared/home-chat/home-chat-types'

/** How scripts run on the machine: a POSIX shell, or PowerShell on Windows. */
export type HomeChatShellDialect = 'posix' | 'powershell'

export type HomeChatMachineInfo = {
  /** `local`, `machine:<id>`, or `hop:<name>`. */
  id: string
  label: string
  kind: 'local' | 'remote' | 'hop'
  /** Older spellings (`ssh:<target-id>`) that saved notes and hops may still use. */
  aliases?: string[]
  /** The `--host` value agents on this machine launch with: the transport it uses now. */
  executionHostId?: string
  /** user@host:port for SSH machines. */
  address?: string
  /** How Seal reaches it when not directly: a ProxyJump/ProxyCommand or another machine's id. */
  via?: string
  /** Ready to run commands right now; an offline SSH machine still connects on demand. */
  connected: boolean
  status: HomeChatMachineStatus
  /** Why it is in an error state. */
  statusDetail?: string
  /** A Seal server is paired on this machine. */
  sealServer?: boolean
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
  /** The account's home folder, where commands start and relative paths are rooted. */
  homeDir: () => Promise<string>
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
  /** Resolve by id, legacy `ssh:` id, or label (case-insensitive); connects machines on demand. */
  open: (machine: string) => Promise<HomeChatMachine>
}

export const LOCAL_MACHINE_ID = 'local'
