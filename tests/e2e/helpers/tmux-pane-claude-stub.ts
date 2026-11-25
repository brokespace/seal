// A stub Claude Code TUI in a tmux pane on a private socket: the registry lists it as an external
// session with a `tmux` input route, types into its prompt box and answers its numbered dialogs.
//
// The scanner reads the machine's whole process table: another app instance lists the stub too,
// but only an app launched with this fixture's TMUX_TMPDIR finds its pane.

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test as base } from './orca-app'

/** A prompt containing this stops on a Bash approval dialog until one of its options is keyed. */
export const TMUX_STUB_ASKS_PERMISSION = '[asks-permission]'
/** A prompt containing this stops on a numbered question until one of its options is keyed. */
export const TMUX_STUB_ASKS_QUESTION = '[asks-question]'

export const TMUX_STUB_PERMISSION = {
  question: 'Do you want to proceed?',
  options: ['Yes', 'Yes, and do not ask again', 'No']
}
export const TMUX_STUB_QUESTION = {
  question: 'Would you like to use tabs or spaces?',
  options: ['Tabs', 'Spaces']
}

const LIFETIME_MS = 15 * 60_000

// Draws what agent-screen.ts reads: a prompt box between two rules, or a dialog of numbered options.
const STUB_SOURCE = `
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const sessionId = process.argv[process.argv.indexOf('--session-id') + 1]
const cwd = process.cwd()
const RULE = '\\u2500'.repeat(60)
const log = (entry) => fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\\n')
let parentUuid = null
let draft = ''
let pasting = false
let turns = 0
let dialog = null
const history = []

const record = (type, fields) => {
  const uuid = randomUUID()
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true })
  fs.appendFileSync(
    transcriptPath,
    JSON.stringify({
      parentUuid,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId,
      version: '2.1.325',
      gitBranch: 'main',
      type,
      uuid,
      timestamp: new Date().toISOString(),
      ...fields
    }) + '\\n'
  )
  parentUuid = uuid
}
const assistant = (content, stopReason) =>
  record('assistant', {
    message: {
      id: 'msg_' + randomUUID().replaceAll('-', '').slice(0, 24),
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4',
      content,
      stop_reason: stopReason
    }
  })

const draw = () => {
  const lines = history.slice(-12)
  if (dialog) {
    lines.push(RULE, ' ' + dialog.header, ' ' + dialog.question)
    dialog.options.forEach((label, i) => lines.push((i === 0 ? ' \\u276f ' : '   ') + (i + 1) + '. ' + label))
    lines.push(' Esc to cancel')
  } else {
    lines.push(RULE, '\\u276f ' + draft.split('\\n').join('\\r\\n  '), RULE, '  ? for shortcuts')
  }
  process.stdout.write('\\x1b[2J\\x1b[H' + lines.join('\\r\\n'))
}

const reply = () => {
  const text = 'Stub reply ' + ++turns + '.'
  assistant([{ type: 'text', text }], 'end_turn')
  record('system', { subtype: 'turn_duration', durationMs: 1000, isMeta: false })
  history.push(text)
  log({ event: 'replied', text })
}

const ask = (spec) => {
  const id = 'toolu_' + randomUUID().replaceAll('-', '').slice(0, 24)
  assistant([{ type: 'tool_use', id, name: spec.tool, input: spec.input }], null)
  dialog = { ...spec, id }
}

const answer = (option) => {
  const content = [{ type: 'tool_result', tool_use_id: dialog.id, content: option }]
  record('user', { message: { role: 'user', content } })
  log({ event: 'answered', question: dialog.question, option })
  history.push('answered: ' + option)
  dialog = null
  reply()
}

const turn = (text) => {
  record('user', { message: { role: 'user', content: text } })
  history.push('you: ' + text)
  log({ event: 'turn', text })
  if (text.includes(${JSON.stringify(TMUX_STUB_ASKS_PERMISSION)})) {
    ask({
      ...permission,
      header: 'Bash command',
      tool: 'Bash',
      input: { command: 'touch stub-approved.txt', description: 'Create the stub probe file' }
    })
  } else if (text.includes(${JSON.stringify(TMUX_STUB_ASKS_QUESTION)})) {
    const options = question.options.map((label) => ({ label, description: label }))
    ask({
      ...question,
      header: 'Style',
      tool: 'AskUserQuestion',
      input: { questions: [{ question: question.question, header: 'Style', options, multiSelect: false }] }
    })
  } else {
    reply()
  }
}

const key = (char) => {
  if (dialog) {
    const option = dialog.options[Number(char) - 1]
    if (option && !pasting) {
      answer(option)
    }
  } else if (pasting) {
    draft += char
  } else if (char === '\\r' || char === '\\n') {
    // A hung TUI: the text stays at the prompt.
    if (fs.existsSync(ignoreEnterPath)) {
      return
    }
    const text = draft.trim()
    draft = ''
    if (text) {
      turn(text)
    }
  } else if (char === '\\x15') {
    draft = ''
  } else if (char >= ' ') {
    draft += char
  }
}

process.stdin.on('data', (chunk) => {
  let data = chunk.toString('utf8')
  while (data.length > 0) {
    const paste = /^\\x1b\\[20([01])~/.exec(data)
    const escape = paste ?? /^\\x1b\\[[0-9;?]*[ -/]*[@-~]/.exec(data)
    if (paste) {
      pasting = paste[1] === '0'
    }
    if (escape) {
      data = data.slice(escape[0].length)
      continue
    }
    const char = String.fromCodePoint(data.codePointAt(0))
    data = data.slice(char.length)
    key(char)
  }
  draw()
})
process.stdin.setRawMode?.(true)
process.stdin.resume()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => process.exit(0))
}
// Bounds a stub a crashed test leaves behind.
setTimeout(() => process.exit(0), ${LIFETIME_MS})

// Bracketed paste on, as the real TUI asks for it.
process.stdout.write('\\x1b[?2004h')
turn(firstPrompt)
draw()
log({ event: 'started', pid: process.pid })
`

export type TmuxPaneClaudeStubEvent =
  | { event: 'started'; pid: number }
  | { event: 'turn'; text: string }
  | { event: 'replied'; text: string }
  | { event: 'answered'; question: string; option: string }

export type TmuxPaneClaudeStub = {
  /** The id rows and the registry use: `local:claude:<providerSessionId>`. */
  sessionId: string
  /** What the pane shows now (`tmux capture-pane`); empty once the pane is gone. */
  screen: () => string
  /** The user types a prompt in the terminal and presses Enter. */
  submit: (text: string) => void
  /** While set, Enter leaves the text at the prompt, as a hung TUI does. */
  ignoreEnter: (ignore: boolean) => void
  /** Ctrl+U in the terminal: empties the prompt. */
  clearPrompt: () => void
  /** What the stub did, oldest first. */
  events: () => TmuxPaneClaudeStubEvent[]
  /** Ends the tmux server and with it the stub. */
  stop: () => void
}

/** The `tmux` on PATH, where the app's own scan looks for it; null when there is none. */
export function resolveTmuxOnPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'tmux')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not in this directory.
    }
  }
  return null
}

const running = new Set<TmuxPaneClaudeStub>()

/** The app scans `$TMUX_TMPDIR/tmux-<uid>/*` for sockets: a folder of this test's own. */
export const test = base.extend<{ tmuxSocketRoot: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixture callbacks require object destructuring here.
  tmuxSocketRoot: async ({}, provideFixture) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-tmux-'))
    await provideFixture(dir)
    stopAllTmuxPaneClaudeStubs()
    rmSync(dir, { recursive: true, force: true })
  },
  launchEnv: async ({ tmuxSocketRoot }, provideFixture) => {
    await provideFixture({ TMUX_TMPDIR: tmuxSocketRoot })
  }
})

/**
 * Starts the stub in a new tmux server under `socketRoot`, in `cwd`. It has had one turn, so the
 * registry names it by its session id at once and titles it `title`.
 */
export async function startTmuxPaneClaudeStub(
  app: ElectronApplication,
  options: { tmux: string; socketRoot: string; cwd: string; title: string }
): Promise<TmuxPaneClaudeStub> {
  // The app scans its own HOME, which the E2E launch points inside the test's user-data folder.
  const home = await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
  const providerSessionId = randomUUID()
  const dir = mkdtempSync(path.join(options.socketRoot, 'stub-'))
  const socketDir = path.join(options.socketRoot, `tmux-${process.getuid?.() ?? 0}`)
  mkdirSync(socketDir, { recursive: true, mode: 0o700 })
  const socket = path.join(socketDir, path.basename(dir))
  const ledgerPath = path.join(dir, 'ledger.jsonl')
  const ignoreEnterPath = path.join(dir, 'ignore-enter')
  const transcriptPath = path.join(
    home,
    '.claude',
    'projects',
    options.cwd.replace(/[^A-Za-z0-9]/g, '-'),
    `${providerSessionId}.jsonl`
  )
  const baked = { transcriptPath, ledgerPath, ignoreEnterPath, firstPrompt: options.title }
  // `ps` must show `node <dir>/claude --session-id <id>` for the scan to take it for Claude Code.
  const script = path.join(dir, 'claude')
  writeFileSync(
    script,
    `const { transcriptPath, ledgerPath, ignoreEnterPath, firstPrompt } = ${JSON.stringify(baked)}\n` +
      `const permission = ${JSON.stringify(TMUX_STUB_PERMISSION)}\n` +
      `const question = ${JSON.stringify(TMUX_STUB_QUESTION)}\n${STUB_SOURCE}`
  )
  const tmux = (...args: string[]): string =>
    execFileSync(options.tmux, ['-S', socket, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`
  tmux(
    ...'-f /dev/null new-session -d -s agent -x 100 -y 30 -c'.split(' '),
    options.cwd,
    `exec ${quote(process.execPath)} ${quote(script)} --session-id ${providerSessionId}`
  )
  const pane = 'agent:0.0'
  const stub: TmuxPaneClaudeStub = {
    sessionId: `local:claude:${providerSessionId}`,
    screen: () => {
      try {
        return tmux('capture-pane', '-p', '-t', pane)
      } catch {
        return ''
      }
    },
    submit: (text) => {
      tmux('send-keys', '-t', pane, '-l', text)
      tmux('send-keys', '-t', pane, 'Enter')
    },
    ignoreEnter: (ignore) =>
      ignore ? writeFileSync(ignoreEnterPath, '') : rmSync(ignoreEnterPath, { force: true }),
    clearPrompt: () => {
      tmux('send-keys', '-t', pane, 'C-u')
    },
    events: () =>
      existsSync(ledgerPath)
        ? readFileSync(ledgerPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
    stop: () => {
      running.delete(stub)
      try {
        tmux('kill-server')
      } catch {
        // The server is already gone.
      }
    }
  }
  running.add(stub)
  return stub
}

/** Ends every stub this test process started. The fixture calls it; a spec may call it sooner. */
export function stopAllTmuxPaneClaudeStubs(): void {
  for (const stub of running) {
    stub.stop()
  }
}
