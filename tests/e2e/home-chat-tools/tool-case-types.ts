import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { HomeChatToolName } from '../../../src/main/home-chat/tools/home-chat-tool-definitions'
import type { ToolOutcome, ToolStep } from '../helpers/home-chat-tool-driver'

export type TargetKey = 'local' | 'ssh-zsh' | 'ssh-bash' | 'ssh-fish' | 'seal-server'

/** One real machine the assistant can work on, and a way to look at it without going through Seal. */
export type Target = {
  key: TargetKey
  /** The account's user name on the machine. */
  username: string
  /** How the model names it in a tool call. */
  machine: string
  /** The label Seal shows for it. */
  label: string
  /** Seal's own id for it: `local` or `machine:<id>`. */
  id: string
  home: string
  loginShell: string
  /** Runs as the machine's user, outside Seal: seeds files and checks what a tool really did. */
  sh: (script: string, stdin?: Buffer | string) => Buffer
}

export type ToolEnv = {
  app: ElectronApplication
  page: Page
  targets: readonly Target[]
  /** One assistant turn in a new thread that makes these tool calls in order. */
  call: (
    steps: readonly ToolStep[],
    options?: { approve?: boolean; chatId?: string; timeoutMs?: number }
  ) => Promise<{ chatId: string; outcomes: ToolOutcome[] }>
  /** Text that scripts the turn of whoever receives it: a routine's run or a worker's task. */
  script: (steps: readonly ToolStep[]) => { text: string; finishedText: string }
  /** A local HTTP server standing in for the public web; `searches` are the queries it was asked. */
  web: { searchUrl: string; pageUrl: string; missingUrl: string; searches: string[] }
  /** Where the SSH accounts listen; each account can log in to the others. */
  sshd: { host: string; port: number }
  /** A git repository registered in the app as a project. */
  projectPath: string
}

export type ToolCase =
  /** The tool acts on a machine: it must work on each one. */
  | { scope: 'each-machine'; run: (env: ToolEnv, target: Target) => Promise<void> }
  /** The tool only works where Seal has a workspace; the other machines are reported as not run. */
  | {
      scope: 'some-machines'
      on: readonly TargetKey[]
      run: (env: ToolEnv, target: Target) => Promise<void>
    }
  /** The tool acts on the app itself (memory, routines, the window): one run covers it. */
  | { scope: 'app'; run: (env: ToolEnv) => Promise<void> }

export type ToolCases = Partial<Record<HomeChatToolName, ToolCase>>

/** `$HOME`-relative scratch folder each case works in; the name carries the characters that break quoting. */
export const WORK_DIR = 'seal e2e work/it\'s "quoted" $HOME & (parens)'
