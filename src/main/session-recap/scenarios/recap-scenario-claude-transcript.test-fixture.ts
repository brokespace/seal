// A scenario's conversation as Claude Code 2.1 writes its transcript: one JSON record per line.
import { appendFile } from 'node:fs/promises'
import type { RecapScenarioStep } from './recap-scenario-schema.test-fixture'

export type RecapScenarioConversation = {
  /** Writes what the step adds to the conversation; false when it adds nothing there. */
  write(step: RecapScenarioStep, at: number): Promise<boolean>
}

const VERSION = '2.1.325'
const CWD = '/srv/shop'
const MODEL = 'claude-opus-5-5'

/** Record ids that are the same on every run, so recorded model replies keep matching. */
function counter(prefix: string): () => string {
  let next = 0
  return () => `${prefix}${String(++next).padStart(6, '0')}`
}

export function claudeScenarioTranscript(
  path: string,
  providerSessionId: string
): RecapScenarioConversation {
  const uuid = counter('00000000-0000-4000-8000-')
  const toolId = counter('toolu_')
  let parentUuid: string | null = null

  const append = async (
    record: Record<string, unknown>,
    at: number,
    sidechain = false
  ): Promise<void> => {
    const id = uuid()
    await appendFile(
      path,
      `${JSON.stringify({
        parentUuid,
        isSidechain: sidechain,
        userType: 'external',
        cwd: CWD,
        sessionId: providerSessionId,
        version: VERSION,
        gitBranch: 'main',
        uuid: id,
        timestamp: new Date(at).toISOString(),
        ...record
      })}\n`
    )
    parentUuid = id
  }
  const user = (content: unknown, at: number, extra: Record<string, unknown> = {}) =>
    append({ type: 'user', message: { role: 'user', content }, ...extra }, at)
  const assistant = (
    content: unknown[],
    at: number,
    stopReason: string | null,
    sidechain = false
  ) =>
    append(
      {
        type: 'assistant',
        message: {
          id: `msg_${uuid().slice(-12)}`,
          type: 'message',
          role: 'assistant',
          model: MODEL,
          content,
          stop_reason: stopReason
        }
      },
      at,
      sidechain
    )
  const toolUse = async (name: string, input: unknown, at: number): Promise<string> => {
    const id = toolId()
    await assistant([{ type: 'tool_use', id, name, input }], at, 'tool_use')
    return id
  }
  const toolResult = (id: string, content: string, at: number, result?: unknown) =>
    user(
      [{ tool_use_id: id, type: 'tool_result', content }],
      at,
      result === undefined ? {} : { toolUseResult: result }
    )

  return {
    async write(step, at) {
      if ('user' in step) {
        await user(step.user, at)
      } else if ('agent' in step) {
        await assistant([{ type: 'text', text: step.agent }], at, 'end_turn')
      } else if ('tool' in step) {
        const id = await toolUse(step.tool.name, step.tool.input, at)
        await toolResult(id, step.tool.output ?? '', at)
      } else if ('edit' in step) {
        const id = await toolUse(
          'Edit',
          { file_path: step.edit, old_string: 'before', new_string: 'after' },
          at
        )
        await toolResult(id, `The file ${step.edit} has been updated.`, at, {
          filePath: step.edit,
          structuredPatch: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }
          ]
        })
      } else if ('question' in step) {
        const { text, options, answer } = step.question
        const questions = [
          {
            question: text,
            header: 'Choice',
            options: options.map((label) => ({ label, description: label })),
            multiSelect: false
          }
        ]
        const id = await toolUse('AskUserQuestion', { questions }, at)
        if (answer !== undefined) {
          await toolResult(
            id,
            `User has answered your questions: "${text}"="${answer}". You can now continue with the user's answers in mind.`,
            at,
            { questions, answers: { [text]: answer } }
          )
        }
      } else if ('subagent' in step) {
        const { prompt, says, result } = step.subagent
        const id = await toolUse(
          'Task',
          { description: prompt.slice(0, 40), prompt, subagent_type: 'general-purpose' },
          at
        )
        const parent = parentUuid
        await append({ type: 'user', message: { role: 'user', content: prompt } }, at, true)
        for (const said of says) {
          await assistant([{ type: 'text', text: said }], at, 'end_turn', true)
        }
        parentUuid = parent
        await toolResult(id, result, at, { status: 'completed', content: result })
      } else if ('compact' in step) {
        await append(
          {
            type: 'system',
            subtype: 'compact_boundary',
            content: 'Conversation compacted',
            isMeta: false,
            level: 'info'
          },
          at
        )
        await user(
          `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n${step.compact}`,
          at,
          { isCompactSummary: true, isVisibleInTranscriptOnly: true }
        )
        // What a manual /compact leaves after its summary (claude-2.1.325-error-resume-compact.jsonl).
        await user(
          "<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It's recorded here as context for later messages.</local-command-caveat>",
          at,
          { isMeta: true }
        )
        await user(
          '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>',
          at
        )
        await user(
          '<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>',
          at
        )
      } else if ('injected' in step) {
        await user(`<system-reminder>\n${step.injected}\n</system-reminder>`, at, { isMeta: true })
      } else if (
        'status' in step &&
        (step.status === 'your-turn' || step.status === 'waiting-input')
      ) {
        await append(
          { type: 'system', subtype: 'turn_duration', durationMs: 1200, isMeta: false },
          at
        )
      } else {
        return false
      }
      return true
    }
  }
}
