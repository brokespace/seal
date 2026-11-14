import type {
  FakeChatMessage,
  FakeChatReply,
  FakeChatRequest
} from '../../../src/main/home-chat/testing/fake-chat-completions-server.test-support'

export const KESSEL = 'kessel-ml'
export const KESSEL_STATUS_LINE = 'kessel-ml: 2x RTX 4090, training job idle since 04:12'
export const GPU_STATUS_LINES = ['GPU 0: 41C, 3% load', 'GPU 1: 39C, 0% load']
export const SCRIPTED_SUMMARY =
  'The user is reviewing the training logs on kessel-ml one part at a time. Parts read so far were clean; each was read with cat ~/logs/part-N.log on kessel-ml.'

const SUMMARY_REQUEST_MARKER = 'replaced by a summary you write now'
const SUMMARY_NOTE_MARKER = 'Summary of the earlier part of this conversation'

function toolTexts(messages: readonly FakeChatMessage[]): string[] {
  return messages.filter((message) => message.role === 'tool').map((m) => m.content ?? '')
}

function call(index: number, name: string, args: Record<string, unknown>): FakeChatReply {
  return { toolCalls: [{ id: `call_${index}`, name, args }] }
}

function partsStillVerbatim(messages: readonly FakeChatMessage[]): string[] {
  return messages.flatMap((message) =>
    (message.tool_calls ?? []).flatMap((toolCall) => {
      const part = /part-(\d+)\.log/.exec(toolCall.function.arguments)?.[1]
      return part ? [part] : []
    })
  )
}

function scripted(request: FakeChatRequest, index: number): FakeChatReply {
  const { messages } = request
  const askIndex = messages.findLastIndex((message) => message.role === 'user')
  const ask = messages[askIndex]?.content ?? ''
  const results = toolTexts(messages.slice(askIndex + 1))
  const step = results.length

  if (ask.includes(SUMMARY_REQUEST_MARKER)) {
    return { text: SCRIPTED_SUMMARY }
  }
  if (/status of kessel-ml/i.test(ask)) {
    if (step === 0) {
      return call(index, 'list_machines', {})
    }
    if (step === 1) {
      return call(index, 'run_command', { machine: KESSEL, command: 'cat ~/kessel-status.txt' })
    }
    const line = /kessel-ml: .*/.exec(results[1])?.[0] ?? 'nothing'
    return { text: `I reached kessel-ml. Its status file says: ${line}` }
  }
  if (/gpu/i.test(ask)) {
    if (step === 0) {
      return call(index, 'list_skills', { machine: KESSEL })
    }
    if (step === 1) {
      return call(index, 'load_skill', { name: 'gpu-check', machine: KESSEL })
    }
    if (step === 2) {
      return call(index, 'run_command', { machine: KESSEL, command: 'cat ~/gpu-status.txt' })
    }
    const readings = results[2].match(/GPU \d: .*/g) ?? []
    return { text: `I followed the gpu-check skill from kessel-ml. ${readings.join('; ')}.` }
  }
  if (/scratch/i.test(ask)) {
    if (step === 0) {
      return call(index, 'run_command', { machine: KESSEL, command: 'rm -rf ~/scratch' })
    }
    return {
      text: results[0].includes('declined')
        ? 'I left the scratch folder alone.'
        : 'The scratch folder on kessel-ml is gone.'
    }
  }
  if (/status file say/i.test(ask)) {
    const line = toolTexts(messages)
      .map((text) => /kessel-ml: .*/.exec(text)?.[0])
      .find(Boolean)
    return { text: line ? `Earlier it said: ${line}` : 'I have no record of that.' }
  }
  if (/which parts/i.test(ask)) {
    const summarized = messages.some((message) => message.content?.includes(SUMMARY_NOTE_MARKER))
    return {
      text: `${summarized ? 'Older parts are covered by my summary.' : 'Nothing was summarized.'} Still in full view: parts ${partsStillVerbatim(messages).join(', ')}.`
    }
  }
  const part = /part (\d+)/i.exec(ask)?.[1]
  if (part) {
    if (step === 0) {
      return call(index, 'run_command', { machine: KESSEL, command: `cat ~/logs/part-${part}.log` })
    }
    return { text: `Part ${part} is clean: no errors, final loss 0.${part}.` }
  }
  return { text: 'Understood.' }
}

/** A model that drives the kessel-ml scenarios and reports token usage like a provider would. */
export function scriptedHomeChatModel(request: FakeChatRequest, index: number): FakeChatReply {
  return {
    ...scripted(request, index),
    usage: { prompt_tokens: Math.ceil(JSON.stringify(request).length / 3.5), completion_tokens: 40 }
  }
}

/** Every assistant tool call in a request must be answered by a tool message with its id. */
export function unansweredToolCalls(messages: readonly FakeChatMessage[]): string[] {
  const answered = new Set(messages.flatMap((m) => (m.tool_call_id ? [m.tool_call_id] : [])))
  return messages
    .flatMap((message) => message.tool_calls ?? [])
    .map((toolCall) => toolCall.id)
    .filter((id) => !answered.has(id))
}
