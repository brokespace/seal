import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { isRecord } from '../home-chat-record-guard'
import type { HomeChatToolContext } from '../tools/home-chat-tool-executor'
import {
  delay,
  readAgentTerminalTail,
  sendToAgentTerminal,
  waitForAgentIdle
} from './home-chat-agent-terminal'
import { agentTerminalHandle, parseOrcaJson, worktreeSelector } from './home-chat-orca-json'

export type HomeChatSubagentState = 'running' | 'idle' | 'failed' | 'stopped'

export type HomeChatSubagent = {
  id: string
  chatId: string
  mode: 'agent' | 'assistant'
  title: string
  task: string
  createdAt: number
  state: HomeChatSubagentState
  /** agent mode */
  host?: string
  project?: string
  worktree?: string
  terminal?: string
  agent?: string
  /** assistant mode */
  workerChatId?: string
  result?: string
  updatedAt: number
}

/** Background assistant chats, owned by the service. */
export type HomeChatWorkerHost = {
  create: (parentChatId: string, title: string) => string
  send: (workerChatId: string, text: string) => void
  stop: (workerChatId: string) => void
  isRunning: (workerChatId: string) => boolean
  lastAnswer: (workerChatId: string) => string
}

export type HomeChatSubagentsDeps = {
  rootDir: string
  runOrcaCli: HomeChatToolContext['runOrcaCli']
  workers: HomeChatWorkerHost
  /** A worker went idle or failed; revive its parent chat with the result. */
  onSettled: (subagent: HomeChatSubagent) => void
}

const SETTLE_DELAY_MS = 20_000
const WAIT_TIMEOUT_MS = 60 * 60_000
const RETRY_MS = 60_000
const MAX_FAILURES = 10
const TAIL_LINES = 60

export const WORKER_BRIEF =
  'You are a background worker started by another Seal chat. Do the task below end to end without asking the user anything (approval cards still reach them). When you finish, reply with a short report: what you did, on which machines, how you verified it, and anything left open.'

function isSubagent(value: unknown): value is HomeChatSubagent {
  return isRecord(value) && typeof value.id === 'string' && typeof value.chatId === 'string'
}

/** Delegated work: Orca agents in worktrees for code, background assistant chats for ops. */
export class HomeChatSubagents {
  private readonly items = new Map<string, HomeChatSubagent>()
  private readonly monitors = new Map<string, AbortController>()
  private readonly path: string

  constructor(private readonly deps: HomeChatSubagentsDeps) {
    this.path = join(deps.rootDir, 'subagents.json')
  }

  async load(): Promise<void> {
    const raw: unknown = await readFile(this.path, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => [])
    for (const item of Array.isArray(raw) ? raw.filter(isSubagent) : []) {
      this.items.set(item.id, item)
      if (item.state === 'running' && item.mode === 'agent') {
        this.monitor(item, 0)
      } else if (item.state === 'running') {
        Object.assign(item, { state: 'failed', result: 'Interrupted when Seal closed.' })
      }
    }
    this.save()
  }

  list(chatId: string): HomeChatSubagent[] {
    return [...this.items.values()].filter((item) => item.chatId === chatId)
  }

  get(id: string): HomeChatSubagent {
    const item = this.items.get(id.trim())
    if (!item) {
      throw new Error(`No subagent ${id}. Call check_subagent without an id to list them.`)
    }
    return item
  }

  async spawnAgent(args: {
    chatId: string
    task: string
    title: string
    host: string
    project: string
    agent: string
  }): Promise<HomeChatSubagent> {
    const name = `${
      args.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'task'
    }-${randomUUID().slice(0, 4)}`
    const result = await this.deps.runOrcaCli(
      [
        'worktree',
        'create',
        '--project',
        args.project,
        '--host',
        args.host,
        '--name',
        name,
        '--agent',
        args.agent,
        '--surface',
        'terminal',
        '--prompt',
        args.task,
        '--json'
      ],
      { timeoutMs: 10 * 60_000 }
    )
    const json = parseOrcaJson(result.stdout)
    const terminal = agentTerminalHandle(json)
    if (result.exitCode !== 0 || !terminal) {
      throw new Error(
        `Could not start the agent: ${(result.stderr || result.stdout).trim().slice(0, 2_000)}`
      )
    }
    const item = this.add({
      chatId: args.chatId,
      mode: 'agent',
      title: args.title,
      task: args.task,
      host: args.host,
      project: args.project,
      agent: args.agent,
      worktree: worktreeSelector(json) ?? name,
      terminal
    })
    this.monitor(item, SETTLE_DELAY_MS)
    return item
  }

  spawnAssistant(args: { chatId: string; task: string; title: string }): HomeChatSubagent {
    const workerChatId = this.deps.workers.create(args.chatId, args.title)
    const item = this.add({
      chatId: args.chatId,
      mode: 'assistant',
      title: args.title,
      task: args.task,
      workerChatId
    })
    this.deps.workers.send(workerChatId, `${WORKER_BRIEF}\n\n<task>\n${args.task}\n</task>`)
    return item
  }

  /** The service calls this whenever a worker chat's turn ends. */
  workerTurnEnded(workerChatId: string, failed: boolean): void {
    const item = [...this.items.values()].find((i) => i.workerChatId === workerChatId)
    if (!item || item.state !== 'running') {
      return
    }
    this.settle(item, failed ? 'failed' : 'idle', this.deps.workers.lastAnswer(workerChatId))
  }

  async check(id: string): Promise<string> {
    const item = this.get(id)
    if (item.mode === 'assistant') {
      const running = item.workerChatId ? this.deps.workers.isRunning(item.workerChatId) : false
      const answer = item.workerChatId ? this.deps.workers.lastAnswer(item.workerChatId) : ''
      return `${describeSubagent(item)}\nworker ${running ? 'is working' : 'is idle'}\nlatest answer:\n${answer || '(none yet)'}`
    }
    return `${describeSubagent(item)}\nterminal output:\n${await this.readTail(item)}`
  }

  async message(id: string, text: string): Promise<HomeChatSubagent> {
    const item = this.get(id)
    if (item.mode === 'assistant' && item.workerChatId) {
      this.deps.workers.send(item.workerChatId, text)
    } else if (item.terminal) {
      await sendToAgentTerminal(this.deps.runOrcaCli, item.terminal, { text })
      this.monitor(item, SETTLE_DELAY_MS)
    }
    Object.assign(item, { state: 'running', updatedAt: Date.now() })
    this.save()
    return item
  }

  async stop(id: string): Promise<HomeChatSubagent> {
    const item = this.get(id)
    this.monitors.get(item.id)?.abort()
    if (item.mode === 'assistant' && item.workerChatId) {
      this.deps.workers.stop(item.workerChatId)
    } else if (item.terminal) {
      await sendToAgentTerminal(this.deps.runOrcaCli, item.terminal, { interrupt: true })
    }
    Object.assign(item, { state: 'stopped', updatedAt: Date.now() })
    this.save()
    return item
  }

  dispose(): void {
    for (const controller of this.monitors.values()) {
      controller.abort()
    }
    this.monitors.clear()
  }

  private add(
    fields: Omit<HomeChatSubagent, 'id' | 'createdAt' | 'updatedAt' | 'state'>
  ): HomeChatSubagent {
    const now = Date.now()
    const item: HomeChatSubagent = {
      id: randomUUID().slice(0, 8),
      createdAt: now,
      updatedAt: now,
      state: 'running',
      ...fields
    }
    this.items.set(item.id, item)
    this.save()
    return item
  }

  private settle(item: HomeChatSubagent, state: HomeChatSubagentState, result: string): void {
    Object.assign(item, { state, result, updatedAt: Date.now() })
    this.save()
    this.deps.onSettled(item)
  }

  private async readTail(item: HomeChatSubagent): Promise<string> {
    if (!item.terminal) {
      return ''
    }
    return readAgentTerminalTail(this.deps.runOrcaCli, item.terminal, TAIL_LINES)
  }

  /** Wait for the agent's terminal to go idle (or exit), then report back once. */
  private monitor(item: HomeChatSubagent, initialDelayMs: number): void {
    this.monitors.get(item.id)?.abort()
    const controller = new AbortController()
    this.monitors.set(item.id, controller)
    const { signal } = controller
    void (async () => {
      let failures = 0
      await delay(initialDelayMs, signal)
      while (!signal.aborted && item.terminal) {
        try {
          const idle = await waitForAgentIdle(
            this.deps.runOrcaCli,
            item.terminal,
            WAIT_TIMEOUT_MS,
            signal
          )
          if (signal.aborted) {
            break
          }
          if (idle) {
            this.settle(item, 'idle', await this.readTail(item))
            break
          }
        } catch (error) {
          if (++failures >= MAX_FAILURES) {
            this.settle(item, 'failed', `Lost track of the agent: ${String(error)}`)
            break
          }
          await delay(RETRY_MS, signal)
        }
      }
      if (this.monitors.get(item.id) === controller) {
        this.monitors.delete(item.id)
      }
    })()
  }

  private save(): void {
    writeFileAtomically(this.path, JSON.stringify([...this.items.values()].slice(-200), null, 2))
  }
}

export function describeSubagent(item: HomeChatSubagent): string {
  const where =
    item.mode === 'agent'
      ? `${item.agent} agent in worktree ${item.worktree} (project ${item.project}, host ${item.host}, terminal ${item.terminal})`
      : `assistant worker (chat ${item.workerChatId})`
  return `${item.id} "${item.title}": ${item.state}, ${where}`
}
