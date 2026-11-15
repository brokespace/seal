// Runs the real scanner over a recorded transcript (`__fixtures__/*.jsonl`) and a host described
// in a few words: whether the agent runs, what `ps` lists under it, what the agent says of itself.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import type { ClaudeRegistryState } from './claude-session-registry'
import type { DiscoveredFile } from './discovery-output'
import { HostSessionScanner, LOCAL_SCAN_LIMITS } from './host-session-scanner'

export const FIXTURES = join(__dirname, '__fixtures__')
export const CLAUDE_DIR = '/home/dev/.claude/projects/-srv-shop'
const CODEX_DIR = '/home/dev/.codex/sessions/2026/11/13'
const AGENT_PID = 4100

function lastWriteOf(text: string): number {
  const stamps = [...text.matchAll(/"timestamp":"([^"]+)"/g)].map((m) => Date.parse(m[1]))
  return Math.max(...stamps)
}

export type ScanOptions = {
  /** The agent process is running (default) or gone. */
  alive?: boolean
  /** How long ago the transcript was last written. */
  quietMs?: number
  /** What its tmux pane shows. */
  screen?: string
  /** Other transcripts on the host (Codex helper threads). */
  beside?: string[]
  /** What `ps` lists under the agents, as `pid ppid etime kind command`; absent when the host lists nothing. */
  children?: string[]
  /** Other agent processes on the host, as `pid ppid tty args`. */
  processes?: string[]
  /** The transcript as it stood when only its first records were written. */
  records?: number
  /** The scan read the transcript from this record on: what came before was out of its reach. */
  readFrom?: number
  /** The host's `ps` listed its processes, so an agent it does not show is gone. */
  listsProcesses?: boolean
  /** Claude Code's own registry entry for the agent, written `afterWriteMs` after the transcript. */
  registry?: { state: ClaudeRegistryState; waitingFor?: string; afterWriteMs?: number }
  /** The session's SISomewhere hook file, written `agoMs` before the scan. */
  hook?: { state: string; agoMs?: number }
  /** A process other than the session's own holds its transcript open (a Codex app-server). */
  heldOpenBy?: number
}

function fixtureFile(name: string, options: ScanOptions = {}): DiscoveredFile {
  const whole = readFileSync(join(FIXTURES, `${name}.jsonl`), 'utf8')
  const lines = whole.trimEnd().split('\n')
  const written = lines.slice(0, options.records ?? lines.length)
  const text = `${written.join('\n')}\n`
  const provider = /^(live-)?codex/.test(name) ? 'codex' : 'claude'
  const id = /"payload":\{"id":"([^"]+)"/.exec(whole)?.[1]
  const file: DiscoveredFile = {
    provider,
    path:
      provider === 'claude'
        ? `${CLAUDE_DIR}/${name}.jsonl`
        : `${CODEX_DIR}/rollout-2026-11-13T10-00-00-${id}.jsonl`,
    // A read that starts mid-file is larger than the scanner's tail, which then drops its first line.
    size: options.readFrom ? LOCAL_SCAN_LIMITS.tailBytes + 1 : Buffer.byteLength(text),
    mtimeMs: lastWriteOf(text),
    head: text,
    tail: options.readFrom ? `\n${written.slice(options.readFrom).join('\n')}\n` : text
  }
  const subagents = join(FIXTURES, `${name}.subagents`)
  if (existsSync(subagents)) {
    file.subagents = readdirSync(subagents)
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => {
        const tail = readFileSync(join(subagents, entry), 'utf8')
        return {
          path: `${CLAUDE_DIR}/${name}/subagents/${entry}`,
          size: Buffer.byteLength(tail),
          mtimeMs: lastWriteOf(tail),
          meta: readFileSync(join(subagents, entry.replace(/\.jsonl$/, '.meta.json')), 'utf8'),
          tail
        }
      })
  }
  return file
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64')

function hostOutput(
  names: string[],
  options: ScanOptions
): { script: string; files: DiscoveredFile[]; now: number } {
  const files = names.map((name, index) => fixtureFile(name, index === 0 ? options : {}))
  const [main] = files
  const wrote = Math.max(...files.map((f) => f.mtimeMs))
  const now = wrote + (options.quietMs ?? 20_000)
  const sessionId = main.path
    .split('/')
    .pop()!
    .replace(/\.jsonl$/, '')
  const lines = [`@@NOW ${Math.floor(now / 1000)}`]
  if (options.alive !== false) {
    lines.push(
      `@@PROC ${AGENT_PID} 1 pts/3 ${main.provider}`,
      `@@CWD ${AGENT_PID} /srv/shop`,
      `@@PIN ${AGENT_PID} open ${main.provider} ${main.path}`
    )
  }
  for (const process of options.processes ?? []) {
    lines.push(`@@PROC ${process}`)
  }
  if (options.heldOpenBy) {
    lines.push(`@@PIN ${options.heldOpenBy} open ${main.provider} ${main.path}`)
  }
  if (options.listsProcesses) {
    lines.push('@@PS')
  }
  if (options.children) {
    lines.push('@@CHILDREN', ...options.children.map((child) => `@@CHILD ${child}`))
  }
  if (options.screen) {
    lines.push(
      '@@TMUX /tmp/tmux-1000/default\t%4\t/dev/pts/3\t900\tmain:0.0',
      `@@SCREEN /tmp/tmux-1000/default\t%4 ${Buffer.from(options.screen).toString('base64')}`
    )
  }
  if (options.registry) {
    const { state, waitingFor, afterWriteMs = 100 } = options.registry
    const entry = {
      pid: AGENT_PID,
      sessionId,
      status: state,
      ...(waitingFor ? { waitingFor } : {}),
      statusUpdatedAt: main.mtimeMs + afterWriteMs
    }
    lines.push(`@@CLAUDESESSION /home/dev/.claude/sessions/${AGENT_PID}.json ${b64(entry)}`)
  }
  if (options.hook) {
    const updated = (now - (options.hook.agoMs ?? 1_000)) / 1000
    const state = { id: sessionId, state: options.hook.state, updated }
    lines.push(`@@HOOK /home/dev/.config/sisomewhere/agents/${sessionId}.json ${b64(state)}`)
  }
  lines.push('@@DONE')
  return { script: lines.join('\n'), files, now }
}

/** One scanner following a session from scan to scan, as the registry does for a machine. */
export function recordedSession(name: string): (options?: ScanOptions) => Promise<LiveSession> {
  let current = hostOutput([name], {})
  const host: LiveSessionHost = {
    machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
    run: async () => current.script,
    transcriptFiles: async () => current.files
  }
  const scanner = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
  return async (options = {}) => {
    current = hostOutput([name, ...(options.beside ?? [])], options)
    return (await scanner.scan(current.now)).sessions[0]
  }
}

export async function scan(name: string, options: ScanOptions = {}): Promise<LiveSession[]> {
  const { script, files, now } = hostOutput([name, ...(options.beside ?? [])], options)
  const host: LiveSessionHost = {
    machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
    run: async () => script,
    transcriptFiles: async () => files
  }
  return (await new HostSessionScanner(host, LOCAL_SCAN_LIMITS).scan(now)).sessions
}

export async function statusOf(name: string, options: ScanOptions = {}) {
  const [session] = await scan(name, options)
  return [session.status, session.statusDetail]
}

export async function sourcedStatusOf(name: string, options: ScanOptions = {}) {
  const [session] = await scan(name, options)
  return [session.status, session.statusSource, session.statusDetail]
}

/** Claude Code's Bash tool: a shell that sources the session's snapshot, then the command. */
export const CLAUDE_SHELL = (etime: string) => [
  `4200 ${AGENT_PID} ${etime} snapshot bash`,
  '4201 4200 00:01 other sleep'
]
/** Codex 0.169 runs commands from its shared app-server, inside its sandbox. */
export const CODEX_APP_SERVER = `4300 ${AGENT_PID} ? /home/dev/.codex/packages/app-server-daemon/releases/0.169.0/codex app-server --listen unix://`
export const CODEX_SHELL = (etime: string) => [
  '4301 4300 20:00 other codex-code-mode-host',
  `4310 4300 ${etime} sandbox codex-linux-sandbox`,
  `4311 4310 ${etime} sandbox bwrap`,
  `4313 4311 ${etime} shell sh`
]
/** Codex's own terminal process runs a unified-exec command as a plain shell under it. */
export const CODEX_COMMAND = (etime: string) => [
  `4400 ${AGENT_PID} ${etime} shell bash`,
  '4401 4400 00:01 other sleep'
]
