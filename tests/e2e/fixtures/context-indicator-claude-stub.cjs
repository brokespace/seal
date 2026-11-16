// A Claude CLI whose context fills turn by turn and that compacts on /compact; generated wrappers pass the launch log first.
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

const MODEL = 'claude-sonnet-4-5'
const WINDOW_TOKENS = 200_000
const AUTO_COMPACT_AT_TOKENS = 160_000
const SYSTEM_PROMPT_TOKENS = 3_200
const SYSTEM_TOOLS_TOKENS = 12_800
// 40%, 82% and 96% of the auto-compact threshold, one step per answered prompt.
const USED_TOKENS_AFTER_PROMPT = [64_000, 131_200, 153_600]
const USED_TOKENS_AFTER_COMPACTION = 20_000
const TURN_MS = 300
// The spec creates this file to let a running compaction finish, so its spinner can be observed.
const COMPACTION_RELEASE = `${launchLog}.finish-compaction`
const COMPACTION_POLL_MS = 50

const sessionId = argValue('--session-id') ?? argValue('--resume') ?? randomUUID()
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const system = (subtype, fields) =>
  write({ type: 'system', subtype, session_id: sessionId, uuid: randomUUID(), ...fields })
const initializeResponse = {
  commands: [],
  models: [{ value: 'default', displayName: 'Default', description: '' }],
  account: {},
  output_style: 'default',
  available_output_styles: ['default']
}
let usedTokens = SYSTEM_PROMPT_TOKENS + SYSTEM_TOOLS_TOKENS
let answeredPrompts = 0

/** The `get_context_usage` answer, shaped as SDKControlGetContextUsageResponse. */
function contextUsage() {
  return {
    categories: [
      {
        id: 'system_prompt',
        name: 'System prompt',
        tokens: SYSTEM_PROMPT_TOKENS,
        color: 'promptBorder',
        kind: 'used'
      },
      {
        id: 'system_tools',
        name: 'System tools',
        tokens: SYSTEM_TOOLS_TOKENS,
        color: 'inactive',
        kind: 'used'
      },
      {
        id: 'messages',
        name: 'Messages',
        tokens: usedTokens - SYSTEM_PROMPT_TOKENS - SYSTEM_TOOLS_TOKENS,
        color: 'purple',
        kind: 'used'
      },
      {
        id: 'free_space',
        name: 'Free space',
        tokens: AUTO_COMPACT_AT_TOKENS - usedTokens,
        color: 'promptBorder',
        kind: 'free'
      },
      {
        id: 'autocompact_buffer',
        name: 'Autocompact buffer',
        tokens: WINDOW_TOKENS - AUTO_COMPACT_AT_TOKENS,
        color: 'inactive',
        kind: 'buffer'
      }
    ],
    totalTokens: usedTokens,
    maxTokens: WINDOW_TOKENS,
    rawMaxTokens: WINDOW_TOKENS,
    percentage: Math.round((usedTokens / WINDOW_TOKENS) * 100),
    gridRows: [],
    model: MODEL,
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold: AUTO_COMPACT_AT_TOKENS,
    isAutoCompactEnabled: true,
    apiUsage: null
  }
}

function sendInit() {
  system('init', {
    model: MODEL,
    cwd: process.cwd(),
    tools: [],
    mcp_servers: [],
    // Echo the launched mode: any other makes the host reopen the CLI, which resets these counts.
    permissionMode: args.includes('--dangerously-skip-permissions')
      ? 'bypassPermissions'
      : (argValue('--permission-mode') ?? 'default'),
    slash_commands: [],
    apiKeySource: 'none',
    output_style: 'default'
  })
}

function answerPrompt(frame) {
  // The CLI's --replay-user-messages echo, which opens the turn.
  write({ ...frame, isReplay: true })
  setTimeout(() => {
    usedTokens = USED_TOKENS_AFTER_PROMPT[answeredPrompts] ?? usedTokens
    answeredPrompts += 1
    const text = `Stub reply ${answeredPrompts}.`
    write({
      type: 'assistant',
      uuid: randomUUID(),
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        id: randomUUID(),
        role: 'assistant',
        model: MODEL,
        content: [{ type: 'text', text }]
      }
    })
    write({
      type: 'result',
      subtype: 'success',
      uuid: randomUUID(),
      session_id: sessionId,
      is_error: false,
      terminal_reason: 'completed',
      result: text
    })
  }, TURN_MS)
}

/** Frame order of a manual /compact as CLI 2.1.283 emits it. */
function compact(frame) {
  system('status', { status: 'compacting' })
  const poll = setInterval(() => {
    if (!fs.existsSync(COMPACTION_RELEASE)) {
      return
    }
    clearInterval(poll)
    const preTokens = usedTokens
    usedTokens = USED_TOKENS_AFTER_COMPACTION
    system('status', { status: null, compact_result: 'success' })
    sendInit()
    system('compact_boundary', {
      compact_metadata: {
        trigger: 'manual',
        pre_tokens: preTokens,
        post_tokens: usedTokens,
        cumulative_dropped_tokens: preTokens - usedTokens,
        duration_ms: 1_000
      }
    })
    const user = { type: 'user', session_id: sessionId, parent_tool_use_id: null }
    write({
      ...user,
      isReplay: false,
      isSynthetic: true,
      uuid: randomUUID(),
      message: {
        role: 'user',
        content: 'This session is being continued from a previous conversation. [summary]'
      }
    })
    write({
      ...user,
      isReplay: true,
      uuid: randomUUID(),
      message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' }
    })
    write({
      type: 'result',
      subtype: 'success',
      uuid: randomUUID(),
      session_id: sessionId,
      is_error: false,
      result: '',
      user_message_uuid: frame.uuid
    })
  }, COMPACTION_POLL_MS)
}

function controlResponse(subtype) {
  if (subtype === 'initialize') {
    return initializeResponse
  }
  return subtype === 'get_context_usage' ? contextUsage() : {}
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
    if (frame?.type === 'user') {
      if (JSON.stringify(frame.message ?? '').includes('/compact')) {
        compact(frame)
      } else {
        answerPrompt(frame)
      }
      continue
    }
    if (frame?.type !== 'control_request') {
      continue
    }
    const subtype = frame.request?.subtype
    write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: frame.request_id,
        response: controlResponse(subtype)
      }
    })
    if (subtype === 'initialize' && !initSent) {
      initSent = true
      sendInit()
    }
  }
})
process.stdin.on('end', () => process.exit(0))
