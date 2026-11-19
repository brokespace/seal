import { randomUUID } from 'node:crypto'
import type {
  AgentConnectorSignInResult,
  AgentConnectorSignInStart
} from '../../shared/agent-connectors/agent-connector-types'
import type { MachineId } from '../../shared/machines/machine-types'
import type { MachineConnection, MachineShell } from '../machines/connection/machine-connection'
import { cleanCliOutput, findAuthorizeUrl, lastCliMessage } from './agent-connector-cli-output'
import type { ConnectorHome } from './agent-connector-homes'
import { agentCommandForHome } from './agent-connector-listing'

const URL_WAIT_MS = 45_000
// The CLI waits on its localhost callback; give the user time to finish in the browser.
const SESSION_LIMIT_MS = 10 * 60_000
const KEEP_RESULT_MS = 60_000
const MAX_OUTPUT_CHARS = 64 * 1024
const MAX_REDIRECT_CHARS = 8 * 1024
// The CLI answers a pasted address at once: it re-prompts when it refuses one.
const PASTE_VERDICT_MS = 2_500
const PASTE_PROMPT = /Or paste the redirect URL/i

type Session = {
  machineId: MachineId
  name: string
  shell: MachineShell
  result: Promise<AgentConnectorSignInResult>
  /** What the CLI printed since the last paste. */
  sincePaste: string
  exited: boolean
}

const sessions = new Map<string, Session>()

function endSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  sessions.delete(sessionId)
  session?.shell.close()
}

/**
 * Runs `<agent> mcp login <name> --no-browser` in a PTY on the machine (the CLI insists on a
 * terminal) and hands back the page it asks the user to open.
 */
export async function startConnectorSignIn(
  connection: MachineConnection,
  home: ConnectorHome,
  name: string
): Promise<AgentConnectorSignInStart> {
  // A login still waiting holds the server's fixed callback port; a second one would fail.
  for (const [id, session] of sessions) {
    if (session.machineId === connection.machineId && session.name === name) {
      endSession(id)
    }
  }
  const sessionId = randomUUID()
  const command = agentCommandForHome(
    home,
    ['mcp', 'login', name, '--no-browser'],
    await connection.dialect()
  )
  let output = ''
  let announce: (url: string | null) => void = () => {}
  const announced = new Promise<string | null>((resolve) => {
    announce = resolve
  })
  let finish: (result: AgentConnectorSignInResult) => void = () => {}
  const result = new Promise<AgentConnectorSignInResult>((resolve) => {
    finish = resolve
  })
  const limit = setTimeout(() => endSession(sessionId), SESSION_LIMIT_MS)
  const shell = await connection.openShell(
    { cols: 1000, rows: 40, command },
    {
      onData: (data) => {
        output = (output + data).slice(-MAX_OUTPUT_CHARS)
        const session = sessions.get(sessionId)
        if (session) {
          session.sincePaste = (session.sincePaste + data).slice(-MAX_OUTPUT_CHARS)
        }
        const url = findAuthorizeUrl(output)
        if (url) {
          announce(url)
        }
      },
      onExit: (exitCode) => {
        clearTimeout(limit)
        const session = sessions.get(sessionId)
        if (session) {
          session.exited = true
        }
        const ok = exitCode === 0 || /Authenticated with "/.test(cleanCliOutput(output))
        finish({ ok, message: lastCliMessage(output) })
        announce(null)
        setTimeout(() => sessions.delete(sessionId), KEEP_RESULT_MS).unref()
      }
    }
  )
  sessions.set(sessionId, {
    machineId: connection.machineId,
    name,
    shell,
    result,
    sincePaste: '',
    exited: false
  })
  const url = await Promise.race([
    announced,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), URL_WAIT_MS))
  ])
  if (url) {
    return { kind: 'url', sessionId, url }
  }
  const ended = await Promise.race([result, Promise.resolve(null)])
  if (ended) {
    return { kind: 'finished', result: ended }
  }
  endSession(sessionId)
  return {
    kind: 'finished',
    result: {
      ok: false,
      message: lastCliMessage(output) ?? 'The agent did not print a sign-in page in time'
    }
  }
}

/**
 * Hands the CLI the address the browser landed on, for when its localhost is not reachable.
 * Resolves to the CLI's refusal, or null once it took the address.
 */
export async function submitConnectorRedirect(
  sessionId: string,
  redirectUrl: string
): Promise<string | null> {
  const value = redirectUrl.trim()
  if (
    !/^https?:\/\//i.test(value) ||
    value.length > MAX_REDIRECT_CHARS ||
    [...value].some((char) => char.charCodeAt(0) < 0x20)
  ) {
    return 'Paste the full address the browser ended on, starting with http'
  }
  const session = sessions.get(sessionId)
  if (!session || session.exited) {
    return 'This sign-in has ended; start it again'
  }
  session.sincePaste = ''
  session.shell.write(`${value}\r`)
  const deadline = Date.now() + PASTE_VERDICT_MS
  while (Date.now() < deadline && !session.exited) {
    // The echo of the pasted address comes first; a second prompt after it is the refusal.
    const reply = cleanCliOutput(session.sincePaste).split(value).at(-1) ?? ''
    if (PASTE_PROMPT.test(reply)) {
      return lastCliMessage(reply.split(PASTE_PROMPT)[0]) ?? 'The agent did not accept that address'
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

export async function waitForConnectorSignIn(
  sessionId: string
): Promise<AgentConnectorSignInResult> {
  const session = sessions.get(sessionId)
  if (!session) {
    return { ok: false, message: 'This sign-in has ended; start it again' }
  }
  return session.result
}

export function cancelConnectorSignIn(sessionId: string): void {
  endSession(sessionId)
}
