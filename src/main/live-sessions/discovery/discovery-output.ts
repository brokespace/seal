import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'

export type DiscoveredProcess = {
  pid: number
  ppid: number
  /** `pts/3`, `ttys003`, or null when it has no terminal. */
  tty: string | null
  args: string
  cwd: string | null
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
}

export type DiscoveryOutput = {
  hostNowMs: number | null
  uname: string | null
  processes: DiscoveredProcess[]
  panes: DiscoveredPane[]
  /** Raw hook state files (SISomewhere-compatible), keyed by path. */
  hookStates: { path: string; text: string }[]
  /** Claude Code's own registry of running sessions (`~/.claude/sessions/<pid>.json`): pid → session. */
  claudeSessions: { pid: number; sessionId: string }[]
  /** Transcripts running agents own, listed whatever their age. */
  pins: TranscriptPin[]
  files: DiscoveredFile[]
  /** The script ran to its end; a cut-off scan must not drop sessions. */
  complete: boolean
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
        const record = parseJsonRecord(decode(pathAndPayload(rest).payload))
        if (record && typeof record.pid === 'number' && typeof record.sessionId === 'string') {
          out.claudeSessions.push({ pid: record.pid, sessionId: record.sessionId })
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
