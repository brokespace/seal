import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'
import type { DiscoveredSubagentFile } from './claude-subagent-files'
import { parseClaudeRegistryEntry, type ClaudeRegistryEntry } from './claude-session-registry'
import { discoveredJobsIn, type DiscoveredJob } from './discovered-host-jobs'

export type DiscoveredProcess = {
  pid: number
  ppid: number
  /** `pts/3`, `ttys003`, or null when it has no terminal. */
  tty: string | null
  args: string
  cwd: string | null
  /** When it started (host clock), from `ps -o etime`; absent when the host's ps did not say. */
  startedAtMs?: number
  /** The processes it runs under, nearest first; absent when the host's ps did not say. */
  ancestors?: number[]
}

/** What a process under an agent is, as far as its command line shows without leaving the host. */
export type DiscoveredChildKind =
  /** Claude Code's Bash tool: a shell that sources `shell-snapshots/…` and runs the command. */
  | 'snapshot'
  /** Codex's sandbox around a command (`codex-linux-sandbox`, `bwrap`, `sandbox-exec`). */
  | 'sandbox'
  | 'shell'
  | 'other'

/** A process running under an agent (or under a Codex app-server, which runs its commands). */
export type DiscoveredChild = {
  pid: number
  ppid: number
  /** How long it has run, from `ps -o etime`. */
  elapsedMs: number
  kind: DiscoveredChildKind
  /** The executable's name, without its path or arguments. */
  command: string
}

export type DiscoveredPane = {
  socket: string
  paneId: string
  /** Without `/dev/`, to match `ps` output. */
  tty: string
  panePid: number
  name: string
  /** `capture-pane -e` text, captured only for panes an agent runs in. */
  screen: string | null
}

/** How the script tied a transcript to a running agent; `cwd` is only a guess for listing it. */
export type TranscriptPinKind = 'open' | 'hook' | 'id' | 'cwd'

export type TranscriptPin = {
  pid: number
  kind: TranscriptPinKind
  provider: LiveSessionProvider
  path: string
}

export type DiscoveredFile = {
  provider: LiveSessionProvider
  path: string
  size: number
  mtimeMs: number
  head: string | null
  tail: string | null
  /** Claude: the session's subagent transcripts, newest first. */
  subagents?: DiscoveredSubagentFile[]
}

export type DiscoveryOutput = {
  hostNowMs: number | null
  uname: string | null
  processes: DiscoveredProcess[]
  /** The host's `ps` listed its processes, so an agent missing from `processes` is not running. */
  processesListed: boolean
  /** Processes under the agents; null when the host listed none (an older script, no `ps`). */
  children: DiscoveredChild[] | null
  /** What the host found of the jobs it was asked about; null when it was not asked or could not list. */
  jobs: DiscoveredJob[] | null
  panes: DiscoveredPane[]
  /** Raw hook state files (SISomewhere-compatible), keyed by path. */
  hookStates: { path: string; text: string }[]
  /** Claude Code's own registry of running sessions (`~/.claude/sessions/<pid>.json`). */
  claudeSessions: ClaudeRegistryEntry[]
  /** Transcripts running agents own, listed whatever their age. */
  pins: TranscriptPin[]
  files: DiscoveredFile[]
  /** The script ran to its end; a cut-off scan must not drop sessions. */
  complete: boolean
}

const CHILD_KINDS: Partial<Record<string, DiscoveredChildKind>> = {
  snapshot: 'snapshot',
  sandbox: 'sandbox',
  shell: 'shell',
  other: 'other'
}

/** `ps -o etime`: `[[dd-]hh:]mm:ss`. */
export function parseElapsedTime(etime: string): number | null {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime.trim())
  if (!m) {
    return null
  }
  const [days, hours, minutes, seconds] = m.slice(1).map((part) => Number(part ?? 0))
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000
}

const PIN_KINDS: Partial<Record<string, TranscriptPinKind>> = {
  open: 'open',
  hook: 'hook',
  id: 'id',
  cwd: 'cwd'
}

function decode(b64: string): string {
  return Buffer.from(b64.trim(), 'base64').toString('utf8')
}

/** Split once at the first space after the tag; the rest of the line is the payload. */
function afterTag(line: string): string {
  const space = line.indexOf(' ')
  return space === -1 ? '' : line.slice(space + 1)
}

/** `path base64`: paths may hold spaces, base64 never does. */
function pathAndPayload(rest: string): { path: string; payload: string } {
  const space = rest.lastIndexOf(' ')
  return space === -1
    ? { path: rest, payload: '' }
    : { path: rest.slice(0, space), payload: rest.slice(space + 1) }
}

export function parseDiscoveryOutput(stdout: string): DiscoveryOutput {
  const out: DiscoveryOutput = {
    hostNowMs: null,
    uname: null,
    processes: [],
    processesListed: false,
    children: null,
    jobs: discoveredJobsIn(stdout),
    panes: [],
    hookStates: [],
    claudeSessions: [],
    pins: [],
    files: [],
    complete: false
  }
  const processes = new Map<number, DiscoveredProcess>()
  const files = new Map<string, DiscoveredFile>()
  const screens = new Map<string, string>()
  const subagents = new Map<string, DiscoveredSubagentFile>()
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('@@')) {
      continue
    }
    const tag = line.slice(2).split(' ', 1)[0]
    const rest = afterTag(line)
    switch (tag) {
      case 'NOW': {
        const seconds = Number(rest)
        out.hostNowMs = Number.isFinite(seconds) ? seconds * 1000 : null
        break
      }
      case 'UNAME':
        out.uname = rest.trim() || null
        break
      case 'PROC': {
        const m = /^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(rest)
        if (m) {
          const tty = m[3] === '?' || m[3] === '??' ? null : m[3]
          processes.set(Number(m[1]), {
            pid: Number(m[1]),
            ppid: Number(m[2]),
            tty,
            args: m[4].trim(),
            cwd: null
          })
        }
        break
      }
      case 'CWD': {
        const m = /^(\d+) (.+)$/.exec(rest)
        const proc = m ? processes.get(Number(m[1])) : undefined
        if (m && proc) {
          proc.cwd = m[2]
        }
        break
      }
      case 'AGE': {
        const [pid, etime] = rest.split(' ')
        const proc = processes.get(Number(pid))
        const elapsedMs = parseElapsedTime(etime ?? '')
        if (proc && elapsedMs !== null && out.hostNowMs !== null) {
          proc.startedAtMs = out.hostNowMs - elapsedMs
        }
        break
      }
      case 'UP': {
        const [pid, ...ancestors] = rest.split(' ').map(Number)
        const proc = processes.get(pid)
        if (proc && ancestors.every(Number.isInteger)) {
          proc.ancestors = ancestors
        }
        break
      }
      case 'PS':
        out.processesListed = true
        break
      case 'CHILDREN':
        out.children ??= []
        break
      case 'CHILD': {
        const m = /^(\d+) (\d+) (\S+) (\w+) (.*)$/.exec(rest)
        const elapsedMs = m ? parseElapsedTime(m[3]) : null
        const kind = m ? CHILD_KINDS[m[4]] : undefined
        if (m && elapsedMs !== null && kind) {
          ;(out.children ??= []).push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            elapsedMs,
            kind,
            command: m[5].trim()
          })
        }
        break
      }
      case 'TMUX': {
        const [socket, paneId, tty, panePid, name] = rest.split('\t')
        if (socket && paneId && tty) {
          out.panes.push({
            socket,
            paneId,
            tty: tty.replace(/^\/dev\//, ''),
            panePid: Number(panePid) || 0,
            name: name ?? '',
            screen: null
          })
        }
        break
      }
      case 'SCREEN': {
        const tab = rest.indexOf('\t')
        const { path: paneId, payload } = pathAndPayload(rest.slice(tab + 1))
        if (tab > 0) {
          screens.set(`${rest.slice(0, tab)}\t${paneId}`, decode(payload))
        }
        break
      }
      case 'CLAUDESESSION': {
        const entry = parseClaudeRegistryEntry(
          parseJsonRecord(decode(pathAndPayload(rest).payload))
        )
        if (entry) {
          out.claudeSessions.push(entry)
        }
        break
      }
      case 'HOOK': {
        const { path, payload } = pathAndPayload(rest)
        out.hookStates.push({ path, text: decode(payload) })
        break
      }
      case 'PIN': {
        const m = /^(\d+) (\w+) (claude|codex) (.+)$/.exec(rest)
        const kind = m ? PIN_KINDS[m[2]] : undefined
        if (m && kind) {
          out.pins.push({
            pid: Number(m[1]),
            kind,
            provider: m[3] === 'codex' ? 'codex' : 'claude',
            path: m[4]
          })
        }
        break
      }
      case 'FILE': {
        const m = /^(claude|codex) (\d+) (\d+) (.+)$/.exec(rest)
        if (m) {
          files.set(m[4], {
            provider: m[1] === 'codex' ? 'codex' : 'claude',
            size: Number(m[2]),
            mtimeMs: Number(m[3]) * 1000,
            path: m[4],
            head: null,
            tail: null
          })
        }
        break
      }
      case 'HEAD':
      case 'TAIL': {
        const { path, payload } = pathAndPayload(rest)
        const file = files.get(path)
        if (file) {
          file[tag === 'HEAD' ? 'head' : 'tail'] = decode(payload)
        }
        break
      }
      case 'SUB': {
        const m = /^(\d+) (\d+) (.+)$/.exec(rest)
        // `<session>/subagents/agent-<id>.jsonl` belongs to `<session>.jsonl`.
        const parent = m ? files.get(m[3].replace(/\/subagents\/[^/]+$/, '.jsonl')) : undefined
        if (m && parent) {
          const sub = {
            path: m[3],
            size: Number(m[1]),
            mtimeMs: Number(m[2]) * 1000,
            meta: null,
            tail: null
          }
          subagents.set(sub.path, sub)
          parent.subagents = [...(parent.subagents ?? []), sub]
        }
        break
      }
      case 'SUBMETA':
      case 'SUBTAIL': {
        const { path, payload } = pathAndPayload(rest)
        const sub = subagents.get(path)
        if (sub) {
          sub[tag === 'SUBMETA' ? 'meta' : 'tail'] = decode(payload)
        }
        break
      }
      case 'DONE':
        out.complete = true
        break
    }
  }
  for (const pane of out.panes) {
    pane.screen = screens.get(`${pane.socket}\t${pane.paneId}`) ?? null
  }
  out.processes = [...processes.values()]
  out.files = [...files.values()]
  return out
}
