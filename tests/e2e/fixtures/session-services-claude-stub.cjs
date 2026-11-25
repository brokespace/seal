// One stand-in `claude` for session services: the scripted utility model in print mode, the structured chat stub otherwise.
// Generated wrappers pass the launch log first; a `session-services-script.json` beside it overrides the script below.
const fs = require('node:fs')
const path = require('node:path')

const [launchLog, ...args] = process.argv.slice(2)

const DEFAULT_SCRIPT = {
  /** The status sentence for a finished turn, and for one that waits on its user. */
  summary: 'Scripted summary: fixed the login redirect.',
  askingSummary: 'Scripted summary: needs your pick between two options.',
  /** A reply holding this phrase is one the classifier says asks; a recap of it gains a question. */
  askMarker: 'should I go ahead',
  recap: {
    title: 'Login redirect fix',
    goal: 'Scripted goal: stop the login page redirecting in a loop.',
    standing: 'Scripted standing: the redirect is fixed and covered by a test.',
    asked: 'Scripted ask: fix the login redirect loop',
    did: 'Scripted work: fixed the login redirect and added a test',
    decision: 'Scripted decision: keep the session check on the server',
    question: 'Scripted question: which of the two options to go ahead with'
  },
  /** Recorded model replies: the first entry whose `match` a recap prompt contains answers it verbatim. */
  recapReplies: [],
  /** When set, every recap request fails with this on stderr. */
  recapFailure: null,
  /** What a new chat is named from its first request (Seal asks the same CLI for it). */
  chatTitle: 'Login redirect chat',
  chat: {
    /** The first entry whose `match` the prompt contains ends the turn with its `reply`. */
    replies: [
      {
        match: 'ask-me',
        reply: 'I looked at both options. Tell me which one you want and should I go ahead'
      }
    ],
    defaultReply: 'Fixed the login redirect and added a test.'
  }
}

function readScript() {
  let saved = {}
  try {
    saved = JSON.parse(
      fs.readFileSync(path.join(path.dirname(launchLog), 'session-services-script.json'), 'utf8')
    )
  } catch {
    // No override file: the defaults stand.
  }
  return {
    ...DEFAULT_SCRIPT,
    ...saved,
    recap: { ...DEFAULT_SCRIPT.recap, ...saved.recap },
    chat: { ...DEFAULT_SCRIPT.chat, ...saved.chat }
  }
}

function argValue(name) {
  const joined = args.find((arg) => arg.startsWith(`${name}=`))
  if (joined) {
    return joined.slice(name.length + 1)
  }
  const index = args.indexOf(name)
  return index !== -1 ? args[index + 1] : undefined
}

/** The text a summary or reply-ask request wraps in its markers. */
function agentMessage(prompt) {
  const open = prompt.lastIndexOf('<agent_message>')
  const close = prompt.lastIndexOf('</agent_message>')
  return open !== -1 && close > open ? prompt.slice(open + '<agent_message>'.length, close) : ''
}

function recapDelta(prompt, script) {
  const messages = prompt.slice(prompt.lastIndexOf('<new_messages>') + 1)
  const tagOf = (role, last) => {
    const tags = [...messages.matchAll(new RegExp(`\\[(m\\d+)\\] ${role}:`, 'g'))].map((m) => m[1])
    return (last ? tags.at(-1) : tags[0]) ?? null
  }
  const item = (text, ref) => ({ text, ...(ref ? { ref } : {}) })
  const user = tagOf('USER', false)
  const agent = tagOf('AGENT', true)
  const asks = messages.toLowerCase().includes(script.askMarker.toLowerCase())
  return {
    title: script.recap.title,
    goal: script.recap.goal,
    standing: script.recap.standing,
    add: {
      asked: [item(script.recap.asked, user)],
      did: [{ ...item(script.recap.did, agent), state: 'done' }],
      decisions: [item(script.recap.decision, agent)],
      ...(asks ? { questions: [item(script.recap.question, agent)] } : {})
    }
  }
}

/** Which of Seal's chores a print-mode prompt is, by the opening of its system text, and the scripted answer. */
function answerUtilityRequest(prompt, script) {
  if (prompt.includes("You label a coding agent's status for a small card.")) {
    const asking = prompt.includes('The agent is waiting for its user.')
    return {
      kind: asking ? 'summary-asking' : 'summary',
      reply: asking ? script.askingSummary : script.summary
    }
  }
  if (prompt.includes('You read the end of the message a coding agent ended its turn with.')) {
    const asks = agentMessage(prompt).toLowerCase().includes(script.askMarker.toLowerCase())
    return { kind: 'reply-ask', reply: asks ? 'ASKS' : 'TELLS' }
  }
  if (prompt.includes('You keep a running recap of one coding-agent session')) {
    if (script.recapFailure) {
      return { kind: 'recap', failure: script.recapFailure }
    }
    const recorded = (script.recapReplies ?? []).find((entry) => prompt.includes(entry.match))
    return { kind: 'recap', reply: recorded?.reply ?? JSON.stringify(recapDelta(prompt, script)) }
  }
  if (prompt.includes("Name this chat from the user's first request.")) {
    return { kind: 'chat-title', reply: script.chatTitle }
  }
  return { kind: 'unknown', reply: 'ready' }
}

function runUtilityRequest() {
  let prompt = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    prompt += String(chunk)
  })
  process.stdin.on('end', () => {
    const { kind, reply = '', failure } = answerUtilityRequest(prompt, readScript())
    fs.appendFileSync(launchLog, `${JSON.stringify({ pid: process.pid, args })}\n`)
    fs.appendFileSync(
      `${launchLog}.utility.jsonl`,
      `${JSON.stringify({ pid: process.pid, kind, args, cwd: process.cwd(), prompt, reply, failure })}\n`
    )
    if (failure) {
      process.stderr.write(`${failure}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`${reply}\n`)
  })
}

/** The existing chat stub, with its fixed reply swapped for the one the prompt scripts. */
function runStructuredChat() {
  let reply = readScript().chat.defaultReply
  let buffer = ''
  process.stdin.on('data', (chunk) => {
    buffer += String(chunk)
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.includes('"user"')) {
        continue
      }
      try {
        const frame = JSON.parse(line)
        if (frame.type === 'user') {
          const { chat } = readScript()
          const prompt = JSON.stringify(frame.message ?? '')
          reply =
            chat.replies.find((entry) => prompt.includes(entry.match))?.reply ?? chat.defaultReply
        }
      } catch {
        // Not a frame: the chat stub ignores it too.
      }
    }
  })
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) => {
    const text = String(chunk)
    if (!text.includes('Stub reply.')) {
      return write(chunk, ...rest)
    }
    const frame = JSON.parse(text)
    if (frame.type === 'assistant') {
      frame.message.content = [{ type: 'text', text: reply }]
    } else if (frame.type === 'result') {
      frame.result = reply
    }
    return write(`${JSON.stringify(frame)}\n`, ...rest)
  }
  require('./structured-claude-stub.cjs')
}

const printsText =
  (args.includes('-p') || args.includes('--print')) && argValue('--output-format') === 'text'
if (printsText) {
  runUtilityRequest()
} else {
  runStructuredChat()
}
