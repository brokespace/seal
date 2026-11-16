// Scripted Claude and Codex CLIs the live-session scan recognises: the process is `node <dir>/claude`
// (or `codex`), the managed hook scripts fire, and the transcript lands where the agent writes it.
import type { Page } from '@stablyai/playwright-test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getManagedScript as getClaudeHookScript } from '../../../src/main/claude/hooks/hook-script'
import { getManagedScript as getCodexHookScript } from '../../../src/main/codex/hooks/definitions/codex-hook-script'
import { buildFakeAgentCommandOverride } from './fake-agent-command-override'
import { GOLDEN_STUB_READY_MARKER, launchGoldenStubAgentFromNewTab } from './golden-stub-agent'
import { waitForActivePanePtyId } from './terminal'

export type DiscoverableStubAgent = 'claude' | 'codex'

/** A prompt containing this keeps its turn running until `STUB_CLI_FINISH_TURN` is submitted. */
export const STUB_CLI_KEEPS_WORKING = '[keeps-working]'
export const STUB_CLI_FINISH_TURN = '[finish-turn]'

/**
 * Claude names its session at startup (SessionStart hook, `sessions/<pid>.json`) and writes its
 * transcript from the first prompt. Codex does nothing until the first prompt: its SessionStart
 * hook and its rollout both wait for the first turn.
 */
const STUB_CLI_SOURCE = `
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')

// Seal probes the launch command (versions, flags, models, the app-server): only a bare launch is a session.
const args = process.argv.slice(2)
if (args.includes('--version')) {
  fs.writeSync(1, agent + ' 0.0.0\\n')
  process.exit(0)
}
if (args.includes('--help')) {
  fs.writeSync(1, 'Usage: ' + agent + ' [OPTIONS] [PROMPT]\\n')
  process.exit(0)
}
if (args.includes('app-server') || args.includes('-p') || args.includes('exec')) {
  fs.writeSync(2, 'error: the stub ' + agent + ' CLI only runs interactively\\n')
  process.exit(2)
}

const cwd = process.cwd()
const log = (entry) => fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\\n')
const stamp = () => new Date().toISOString()
const named = process.argv.findIndex((arg) => arg === '--session-id' || arg === '--resume')
const sessionId = (named > 0 && process.argv[named + 1]) || randomUUID()
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const codexDir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const registryPath = path.join(claudeDir, 'sessions', process.pid + '.json')
let transcriptPath =
  agent === 'claude'
    ? path.join(claudeDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), sessionId + '.jsonl')
    : null
let parentUuid = null
let turnId = null
let state = 'idle'

const hook = (name, extra) =>
  spawnSync('sh', [hookScript], {
    input: JSON.stringify({
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd,
      hook_event_name: name,
      ...(agent === 'codex' ? { model: 'gpt-stub', turn_id: turnId } : {}),
      ...extra
    }),
    env: process.env
  })

const append = (record) => {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true })
  fs.appendFileSync(transcriptPath, JSON.stringify(record) + '\\n')
}
const claudeRecord = (type, fields) => {
  const uuid = randomUUID()
  append({
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd,
    sessionId,
    version: '2.1.325',
    gitBranch: 'main',
    type,
    uuid,
    timestamp: stamp(),
    ...fields
  })
  parentUuid = uuid
}
const codexRecord = (type, payload) => append({ timestamp: stamp(), type, payload })

const startCodexSession = () => {
  const at = new Date()
  const day = [at.getFullYear(), at.getMonth() + 1, at.getDate()].map((n) => String(n).padStart(2, '0'))
  const file = 'rollout-' + at.toISOString().slice(0, 19).replace(/:/g, '-') + '-' + sessionId + '.jsonl'
  transcriptPath = path.join(codexDir, 'sessions', ...day, file)
  codexRecord('session_meta', {
    id: sessionId,
    timestamp: stamp(),
    cwd,
    originator: 'codex_cli_rs',
    cli_version: '0.169.0',
    source: 'cli',
    model_provider: 'openai'
  })
  // The real CLI holds its rollout open for as long as it runs.
  fs.openSync(transcriptPath, 'a')
  log({ event: 'session', sessionId, transcriptPath })
  hook('SessionStart', { source: 'startup' })
}

const prompt = () => process.stdout.write('\\r\\n> ')

const finish = (message) => {
  if (agent === 'claude') {
    claudeRecord('assistant', {
      message: {
        id: 'msg_' + randomUUID().slice(0, 24),
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4',
        content: [{ type: 'text', text: message }],
        stop_reason: 'end_turn'
      }
    })
    claudeRecord('system', { subtype: 'turn_duration', durationMs: 1000, isMeta: false })
  } else {
    codexRecord('event_msg', { type: 'agent_message', message })
    codexRecord('response_item', {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: message }]
    })
    codexRecord('event_msg', { type: 'task_complete', last_agent_message: message })
  }
  process.stdout.write('\\r\\n' + message)
  hook('Stop', { last_assistant_message: message })
  state = 'idle'
  log({ event: 'finished', message })
  prompt()
}

const turn = (text) => {
  state = 'working'
  turnId = randomUUID()
  if (agent === 'codex' && !transcriptPath) {
    startCodexSession()
  }
  hook('UserPromptSubmit', { prompt: text })
  if (agent === 'claude') {
    claudeRecord('user', { message: { role: 'user', content: text } })
  } else {
    const content = [{ type: 'input_text', text }]
    codexRecord('response_item', { type: 'message', role: 'user', content })
    codexRecord('event_msg', { type: 'user_message', message: text, kind: 'plain' })
    codexRecord('event_msg', { type: 'task_started', model_context_window: 272000 })
  }
  // Logged after the hooks return, so a reader of the ledger knows the host has the turn.
  log({ event: 'turn', text })
  if (!text.includes(${JSON.stringify(STUB_CLI_KEEPS_WORKING)})) {
    finish('REPLY ' + text)
  }
}

let exiting = false
const exit = () => {
  if (exiting) {
    return
  }
  exiting = true
  if (agent === 'claude') {
    hook('SessionEnd', { reason: 'prompt_input_exit' })
    fs.rmSync(registryPath, { force: true })
  }
  log({ event: 'exited' })
  process.exit(0)
}

const submit = (line) => {
  if (line === 'exit') {
    exit()
  } else if (state === 'working') {
    if (line.includes(${JSON.stringify(STUB_CLI_FINISH_TURN)})) {
      finish('REPLY after working')
    }
  } else if (line) {
    turn(line)
  } else {
    prompt()
  }
}

let composer = ''
process.stdin.on('data', (chunk) => {
  // Paste brackets and other control sequences are not text.
  const data = chunk.toString('utf8').replace(/\\x1b\\[[0-9;?]*[ -/]*[@-~]/g, '')
  for (const char of data) {
    if (char === '\\r' || char === '\\n') {
      const line = composer.trim()
      composer = ''
      submit(line)
    } else if (char === '\\x03' || char === '\\x04') {
      exit()
    } else if (char === '\\x7f') {
      composer = composer.slice(0, -1)
    } else if (char >= ' ') {
      composer += char
      process.stdout.write(char)
    }
  }
})
process.stdin.setRawMode?.(true)
process.stdin.resume()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, exit)
}

if (agent === 'claude') {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify({ pid: process.pid, sessionId, cwd, startedAt: Date.now() }))
  hook('SessionStart', { source: 'startup' })
}
// Logged before the marker a launch waits for.
const paneKey = process.env.ORCA_PANE_KEY ?? null
log({ event: 'started', agent, pid: process.pid, sessionId, paneKey, cwd, argv: args })
process.stdout.write(agent + ' stub CLI [${GOLDEN_STUB_READY_MARKER}]')
prompt()
`

export type StubAgentCliEvent =
  | {
      event: 'started'
      agent: DiscoverableStubAgent
      pid: number
      /** The id the stub's hooks and transcript name; Codex announces it with its first prompt. */
      sessionId: string
      paneKey: string | null
      cwd: string
      argv: string[]
    }
  | { event: 'session'; sessionId: string; transcriptPath: string }
  | { event: 'turn'; text: string }
  | { event: 'finished'; message: string }
  | { event: 'exited' }

export type DiscoverableStubAgentCli = {
  agent: DiscoverableStubAgent
  /** An executable named for its agent, as the scan's process match expects. */
  command: string
  ledger: () => StubAgentCliEvent[]
}

export function writeDiscoverableStubAgentCli(
  dir: string,
  agent: DiscoverableStubAgent
): DiscoverableStubAgentCli {
  const hookScript = path.join(dir, `${agent}-hook.sh`)
  writeFileSync(
    hookScript,
    agent === 'claude' ? getClaudeHookScript('posix') : getCodexHookScript('posix')
  )
  chmodSync(hookScript, 0o755)
  const ledgerPath = path.join(dir, `${agent}-ledger.jsonl`)
  const command = path.join(dir, agent)
  const paths = `const [agent, ledgerPath, hookScript] = ${JSON.stringify([agent, ledgerPath, hookScript])}`
  writeFileSync(command, `#!${process.execPath}\n${paths}\n${STUB_CLI_SOURCE}`)
  chmodSync(command, 0o755)
  return {
    agent,
    command,
    ledger: () =>
      existsSync(ledgerPath)
        ? readFileSync(ledgerPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : []
  }
}

/** Point each agent's launch command at its stub; launch with `launchDiscoverableStubAgentCli`. */
export async function configureDiscoverableStubAgentClis(
  page: Page,
  clis: readonly DiscoverableStubAgentCli[]
): Promise<void> {
  const commands = Object.fromEntries(
    clis.map((cli) => [cli.agent, buildFakeAgentCommandOverride(cli.command)])
  )
  await page.evaluate(async (commands) => {
    const store = window.__store
    if (!store) {
      throw new Error('Seal store is unavailable')
    }
    await store.getState().updateSettings({
      agentCmdOverrides: commands,
      agentDefaultArgs: Object.fromEntries(Object.keys(commands).map((agent) => [agent, '']))
    })
  }, commands)
}

export type StubAgentCliLaunch = Extract<StubAgentCliEvent, { event: 'started' }> & {
  paneKey: string
  /** The PTY of the pane it runs in, for `sendToTerminal`. */
  ptyId: string
}

/** Opens the agent from the tab bar's New tab menu and returns what the stub says of itself. */
export async function launchDiscoverableStubAgentCli(
  page: Page,
  cli: DiscoverableStubAgentCli
): Promise<StubAgentCliLaunch> {
  await launchGoldenStubAgentFromNewTab(
    page,
    cli.agent === 'claude' ? /^Claude(?:\s|$)/i : /^Codex(?:\s|$)/i
  )
  const ptyId = await waitForActivePanePtyId(page)
  const started = cli.ledger().findLast((entry) => entry.event === 'started')
  if (!started?.paneKey) {
    throw new Error(`The stub ${cli.agent} CLI did not start in a Seal pane`)
  }
  return { ...started, paneKey: started.paneKey, ptyId }
}
