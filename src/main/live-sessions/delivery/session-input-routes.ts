import { randomBytes } from 'node:crypto'
import type {
  LivePermissionAnswer,
  LivePermissionAnswerResult,
  LiveSession,
  LiveSessionInputRoute
} from '../../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { parseAgentScreen, screenAcceptsInput, type AgentScreen } from '../discovery/agent-screen'
import { permissionPromptId } from '../discovery/session-assembly'
import { normalizeForMatch, sanitizeTypedText } from './transcript-user-texts'

export type RouteAttempt =
  /** In the agent's hands; the transcript decides when it is delivered. */
  | { outcome: 'sent' }
  /** The prompt isn't free (a draft, a dialog); try again shortly. */
  | { outcome: 'busy' }
  /** Nothing reached the session; the next route may try. */
  | { outcome: 'unavailable'; reason: string }
  /** Bytes may have reached the session: never try another route, or it could arrive twice. */
  | { outcome: 'failed'; error: string }

/** Seal's own pane writer and prompt answers, from the Orca runtime. */
export type SealPaneInput = {
  send(
    paneKey: string,
    agent: LiveSession['provider'],
    text: string,
    requestId: string,
    signal: AbortSignal
  ): Promise<RouteAttempt>
  answer(
    paneKey: string,
    agent: LiveSession['provider'],
    answer: { promptId: string; optionId: string },
    signal: AbortSignal
  ): Promise<LivePermissionAnswerResult>
}

export type SessionInputDeps = {
  host(hostId: string): LiveSessionHost | null
  sealPanes: SealPaneInput | null
  sleep?: (ms: number) => Promise<void>
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

const B64_DECODE = '{ base64 -d 2>/dev/null || base64 -D; }'

type TmuxRoute = Extract<LiveSessionInputRoute, { kind: 'tmux' }>

function tmux(route: TmuxRoute): string {
  return route.socket ? `tmux -S ${shQuote(route.socket)}` : 'tmux'
}

async function capture(host: LiveSessionHost, route: TmuxRoute): Promise<AgentScreen> {
  const out = await host.run(
    `${tmux(route)} capture-pane -p -e -t ${shQuote(route.target)} | base64 | tr -d '\\n'; echo`
  )
  return parseAgentScreen(Buffer.from(out.trim(), 'base64').toString('utf8'))
}

function pasteSettleMs(text: string): number {
  return Math.min(2_000, 200 + Math.floor(text.length / 2_000) * 100)
}

/** Paste as one bracketed paste (new lines stay in the message), then Enter, then check it went. */
export async function typeIntoTmux(
  host: LiveSessionHost,
  route: TmuxRoute,
  text: string,
  sleep: (ms: number) => Promise<void>
): Promise<RouteAttempt> {
  const before = await capture(host, route)
  if (!screenAcceptsInput(before)) {
    return { outcome: 'busy' }
  }
  const buffer = `seal-${randomBytes(6).toString('hex')}`
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const out = await host.run(
    `t=$(mktemp); printf %s ${shQuote(b64)} | ${B64_DECODE} > "$t"; ` +
      `${tmux(route)} load-buffer -b ${buffer} "$t" && ${tmux(route)} paste-buffer -p -r -d -b ${buffer} -t ${shQuote(route.target)}; ` +
      `rc=$?; rm -f "$t"; echo "@@RC $rc"`
  )
  if (!/@@RC 0/.test(out)) {
    return { outcome: 'unavailable', reason: 'tmux could not paste into the pane' }
  }
  await sleep(pasteSettleMs(text))
  for (let attempt = 0; attempt < 3; attempt++) {
    const sent = await host.run(
      `${tmux(route)} send-keys -t ${shQuote(route.target)} Enter && echo "@@RC 0"`
    )
    if (!/@@RC 0/.test(sent)) {
      return {
        outcome: 'failed',
        error: 'The message is at the prompt, but Enter could not be sent'
      }
    }
    for (let waited = 0; waited < 2_000; waited += 150) {
      await sleep(150)
      const screen = await capture(host, route).catch(() => null)
      // Taken: the box is empty again, or the agent moved on to something of its own.
      if (!screen || !screen.promptBox || screen.draft === '') {
        return { outcome: 'sent' }
      }
    }
  }
  const after = await capture(host, route).catch(() => null)
  if (after?.promptBox && normalizeForMatch(after.draft) === normalizeForMatch(text)) {
    return { outcome: 'failed', error: 'The message is at the prompt, but Enter did not send it' }
  }
  return { outcome: 'sent' }
}

type CodexQueueRoute = Extract<LiveSessionInputRoute, { kind: 'codex-queue' }>

/** Codex's own queue: the running TUI takes it as a user turn once any running turn ends. */
export function codexQueueCommand(route: CodexQueueRoute, text: string): string {
  const b64 = shQuote(Buffer.from(text, 'utf8').toString('base64'))
  const codex = route.binary ? shQuote(route.binary) : 'codex'
  const home = route.codexHome ? `CODEX_HOME=${shQuote(route.codexHome)} ` : ''
  return (
    `T=$(printf %s ${b64} | ${B64_DECODE}); ` +
    `command -v ${codex} >/dev/null 2>&1 || { echo "@@MISSING"; exit 0; }; ` +
    `${home}${codex} queue --thread ${shQuote(route.thread)} --message "$T" </dev/null 2>&1; echo "@@RC $?"`
  )
}

export function codexQueueOutcome(out: string): RouteAttempt {
  if (/^Queued message \S+ for thread/m.test(out)) {
    return { outcome: 'sent' }
  }
  if (out.includes('@@MISSING')) {
    return { outcome: 'unavailable', reason: 'codex is not on the session machine' }
  }
  // Older Codex has no `queue`; nothing was queued, so the next route may type it instead.
  const said =
    out
      .replace(/@@RC \d+\s*$/, '')
      .trim()
      .split('\n')
      .at(-1) ?? ''
  return { outcome: 'unavailable', reason: `codex queue refused it${said ? ` (${said})` : ''}` }
}

const RESUME_TURN_LIMIT_S = 2 * 60 * 60

/** A closed session: the CLI resumes it headless, which appends to the same transcript. */
export function resumeCommand(session: LiveSession, text: string): string {
  const b64 = shQuote(Buffer.from(text, 'utf8').toString('base64'))
  const id = shQuote(session.providerSessionId)
  const run =
    session.provider === 'claude'
      ? `claude -p --resume ${id} "$T"`
      : `codex exec --skip-git-repo-check resume ${id} "$T"`
  const cwd = session.cwd ? `cd ${shQuote(session.cwd)} 2>/dev/null; ` : ''
  // A clean environment: Seal's own CLAUDECODE/CLAUDE_CODE_* would make the child think it's nested.
  return (
    `${cwd}T=$(printf %s ${b64} | ${B64_DECODE}); ` +
    `command -v ${session.provider} >/dev/null 2>&1 || { echo "@@MISSING"; exit 0; }; ` +
    // One turn, then it exits; the time limit ends a turn that hangs instead of leaving it behind.
    `TO=$(command -v timeout || command -v gtimeout); ` +
    `nohup env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \${TO:+"$TO" ${RESUME_TURN_LIMIT_S}} ${run} </dev/null >/dev/null 2>&1 & echo "@@STARTED"`
  )
}

export class SessionInputRoutes {
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: SessionInputDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async attempt(
    session: LiveSession,
    route: LiveSessionInputRoute,
    text: string,
    requestId: string,
    signal: AbortSignal
  ): Promise<RouteAttempt> {
    const typed = sanitizeTypedText(text)
    if (!typed) {
      return { outcome: 'failed', error: 'The message is empty' }
    }
    if (route.kind === 'seal-pane') {
      if (!this.deps.sealPanes) {
        return { outcome: 'unavailable', reason: 'Seal panes are not reachable from here' }
      }
      return this.deps.sealPanes.send(route.paneKey, session.provider, typed, requestId, signal)
    }
    const host = this.deps.host(session.machine.hostId)
    if (!host) {
      return { outcome: 'unavailable', reason: `${session.machine.label} is not connected` }
    }
    if (route.kind === 'tmux') {
      return typeIntoTmux(host, route, typed, this.sleep)
    }
    if (route.kind === 'codex-queue') {
      return codexQueueOutcome(await host.run(codexQueueCommand(route, typed)))
    }
    const out = await host.run(resumeCommand(session, typed))
    if (out.includes('@@MISSING')) {
      return {
        outcome: 'unavailable',
        reason: `${session.provider} is not installed on ${session.machine.label}`
      }
    }
    return out.includes('@@STARTED')
      ? { outcome: 'sent' }
      : { outcome: 'failed', error: 'The resume command did not start' }
  }

  async answer(
    session: LiveSession,
    answer: LivePermissionAnswer
  ): Promise<LivePermissionAnswerResult> {
    const prompt = session.permission
    if (!prompt || prompt.promptId !== answer.promptId) {
      return { ok: false, reason: 'prompt_not_pending' }
    }
    if (!prompt.options.some((o) => o.id === answer.optionId)) {
      return { ok: false, reason: 'option_not_offered' }
    }
    const pane = session.inputRoutes.find((r) => r.kind === 'seal-pane')
    if (pane && session.statusSource !== 'screen' && this.deps.sealPanes) {
      return this.deps.sealPanes.answer(
        pane.paneKey,
        session.provider,
        answer,
        AbortSignal.timeout(15_000)
      )
    }
    const route = session.inputRoutes.find((r): r is TmuxRoute => r.kind === 'tmux')
    const host = this.deps.host(session.machine.hostId)
    if (!route || !host) {
      return { ok: false, reason: 'not_answerable' }
    }
    // Re-read right before the key: a different dialog may be up by now.
    const screen = await capture(host, route)
    if (!screen.approval || permissionPromptId(route.target, screen) !== answer.promptId) {
      return { ok: false, reason: 'prompt_not_pending' }
    }
    const option = screen.approval.options.find((o) => o.id === answer.optionId)
    if (!option) {
      return { ok: false, reason: 'option_not_offered' }
    }
    const out = await host.run(
      `${tmux(route)} send-keys -t ${shQuote(route.target)} -l ${shQuote(option.keys)} && echo "@@RC 0"`
    )
    return /@@RC 0/.test(out)
      ? { ok: true }
      : { ok: false, reason: 'failed', error: 'tmux send-keys failed' }
  }
}
