// Model stream-json initialize and short prompt turns without a real Claude CLI; generated wrappers pass the launch log first.
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')

const [launchLog, ...args] = process.argv.slice(2)
fs.appendFileSync(launchLog, `${JSON.stringify({ pid: process.pid, args })}\n`)

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write('2.1.280 (Claude Code)\n')
  process.exit(0)
}

function argValue(name) {
  const joined = args.find((arg) => arg.startsWith(`${name}=`))
  if (joined) {
    return joined.slice(name.length + 1)
  }
  const index = args.indexOf(name)
  return index !== -1 ? args[index + 1] : undefined
}

const sessionId = argValue('--session-id') ?? argValue('--resume') ?? randomUUID()
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const initializeResponse = {
  commands: [],
  models: [{ value: 'default', displayName: 'Default', description: '' }],
  account: {},
  output_style: 'default',
  available_output_styles: ['default']
}

// A prompt containing "slow" runs until it is interrupted; one containing "plugin-ui" first gets the
// frames a plugin's `$.ui.status` and `$.ui.toast` calls produce in stream-json mode. One containing
// "needs-approval" asks to run a Bash command and one containing "asks-question" asks a question
// (approval first when both), each as the CLI's `can_use_tool` request, before the reply.
const TURN_MS = 500
const SLOW_TURN_MS = 60_000
let turnTimer = null
/** The `can_use_tool` request the turn waits on: its id and what to do with the host's answer. */
let pendingAsk = null

const APPROVAL_ASK = {
  toolName: 'Bash',
  input: { command: 'touch stub-approved.txt', description: 'Create the stub probe file' },
  request: { display_name: 'Bash', description: 'Create the stub probe file' }
}
const QUESTION_ASK = {
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: 'Tabs or spaces?',
        header: 'Style',
        multiSelect: false,
        options: [
          { label: 'Tabs', description: 'Indent with tabs' },
          { label: 'Spaces', description: 'Indent with spaces' }
        ]
      }
    ]
  },
  request: { display_name: 'AskUserQuestion', requires_user_interaction: true }
}

function writeSessionState(state) {
  write({
    type: 'system',
    subtype: 'session_state_changed',
    state,
    uuid: randomUUID(),
    session_id: sessionId
  })
}

/** The tool call, then the permission request the CLI holds the tool on until the host answers. */
function ask({ toolName, input, request }, onAnswered) {
  const toolUseId = `toolu_${randomUUID().replaceAll('-', '')}`
  write({
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: randomUUID(),
      role: 'assistant',
      model: 'claude-fake',
      content: [{ type: 'tool_use', id: toolUseId, name: toolName, input }]
    }
  })
  writeSessionState('requires_action')
  const requestId = randomUUID()
  pendingAsk = {
    requestId,
    answered: (response) => {
      const allowed = response?.behavior === 'allow'
      const answers = response?.updatedInput?.answers
      writeSessionState('running')
      write({
        type: 'user',
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: !allowed
                ? (response?.message ?? 'The user denied this tool call.')
                : answers
                  ? `User has answered your questions: ${JSON.stringify(answers)}`
                  : `(${toolName} completed with no output)`,
              is_error: !allowed
            }
          ]
        }
      })
      onAnswered()
    }
  }
  write({
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'can_use_tool',
      tool_name: toolName,
      input,
      permission_suggestions: [],
      tool_use_id: toolUseId,
      ...request
    }
  })
}

function askEach(asks, onDone) {
  const [next, ...rest] = asks
  if (!next) {
    onDone()
    return
  }
  ask(next, () => askEach(rest, onDone))
}

function startTurn(frame) {
  // The CLI's --replay-user-messages echo, which opens the turn.
  write({ ...frame, isReplay: true })
  const prompt = JSON.stringify(frame.message ?? '')
  const slow = prompt.includes('slow')
  const pluginUi = prompt.includes('plugin-ui')
  if (prompt.includes('plugin-focus')) {
    write({
      type: 'system',
      subtype: 'ui_panes',
      session_id: sessionId,
      uuid: randomUUID(),
      panes: [{ id: 'blast-radius', title: 'Blast Radius', plugin: 'blast-radius', rows: 10 }],
      shown_id: 'blast-radius',
      focused_id: null,
      focus_requested_id: 'blast-radius'
    })
    return
  }
  const asks = [
    ...(prompt.includes('needs-approval') ? [APPROVAL_ASK] : []),
    ...(prompt.includes('asks-question') ? [QUESTION_ASK] : [])
  ]
  turnTimer = setTimeout(
    () => {
      turnTimer = null
      askEach(asks, () => finishTurn(pluginUi))
    },
    slow ? SLOW_TURN_MS : TURN_MS
  )
}

function finishTurn(pluginUi) {
  if (pluginUi) {
    const ui = { type: 'system', plugin: 'e2e-board', session_id: sessionId }
    write({
      ...ui,
      subtype: 'ui_status',
      text: 'PR 6 · 진행 13 · 대기 6   /board',
      uuid: randomUUID()
    })
    write({
      ...ui,
      subtype: 'ui_toast',
      text: 'Board synced',
      timeout_ms: 3000,
      uuid: randomUUID()
    })
  }
  write({
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: randomUUID(),
      role: 'assistant',
      model: 'claude-fake',
      content: [{ type: 'text', text: 'Stub reply.' }]
    }
  })
  write({
    type: 'result',
    subtype: 'success',
    uuid: randomUUID(),
    session_id: sessionId,
    is_error: false,
    terminal_reason: 'completed',
    result: 'Stub reply.'
  })
}

function interruptTurn() {
  if (!turnTimer && !pendingAsk) {
    return
  }
  clearTimeout(turnTimer)
  turnTimer = null
  if (pendingAsk) {
    write({ type: 'control_cancel_request', request_id: pendingAsk.requestId })
    pendingAsk = null
  }
  write({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    session_id: sessionId,
    parent_tool_use_id: null
  })
}

let buffer = ''
let initSent = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += String(chunk)
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    let frame
    try {
      frame = line ? JSON.parse(line) : null
    } catch {
      frame = null
    }
    fs.appendFileSync(
      `${launchLog}.requests.jsonl`,
      `${JSON.stringify({
        pid: process.pid,
        type: frame?.type ?? null,
        subtype: frame?.request?.subtype ?? null
      })}\n`
    )
    if (frame?.type === 'user') {
      startTurn(frame)
      continue
    }
    if (
      frame?.type === 'control_response' &&
      pendingAsk &&
      frame.response?.request_id === pendingAsk.requestId
    ) {
      const { answered } = pendingAsk
      pendingAsk = null
      answered(frame.response.response)
      continue
    }
    if (frame?.type !== 'control_request') {
      continue
    }
    const subtype = frame.request?.subtype
    if (subtype === 'interrupt') {
      interruptTurn()
    }
    write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: frame.request_id,
        response: subtype === 'initialize' ? initializeResponse : {}
      }
    })
    if (subtype === 'initialize' && !initSent) {
      initSent = true
      write({
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        uuid: randomUUID(),
        model: 'claude-fake',
        cwd: process.cwd(),
        tools: [],
        mcp_servers: [],
        permissionMode: 'default',
        slash_commands: [],
        apiKeySource: 'none',
        output_style: 'default'
      })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
