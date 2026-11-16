// A scenario's conversation as Codex CLI 0.169 writes its rollout: one JSON record per line.
import { appendFile } from 'node:fs/promises'
import type { RecapScenarioConversation } from './recap-scenario-claude-transcript.test-fixture'

export function codexScenarioTranscript(
  path: string,
  providerSessionId: string
): RecapScenarioConversation {
  let calls = 0
  let started = false
  let lastAgentMessage = ''

  const append = (type: string, payload: Record<string, unknown>, at: number): Promise<void> =>
    appendFile(
      path,
      `${JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload })}\n`
    )
  const start = async (at: number): Promise<void> => {
    if (!started) {
      started = true
      await append(
        'session_meta',
        {
          id: providerSessionId,
          timestamp: new Date(at).toISOString(),
          cwd: '/srv/shop',
          originator: 'codex_cli_rs',
          cli_version: '0.169.0',
          source: 'cli',
          model_provider: 'openai'
        },
        at
      )
    }
  }
  const call = async (name: string, input: unknown, output: string, at: number): Promise<void> => {
    const callId = `call_${String(++calls).padStart(6, '0')}`
    await append(
      'response_item',
      { type: 'function_call', name, arguments: JSON.stringify(input), call_id: callId },
      at
    )
    await append('response_item', { type: 'function_call_output', call_id: callId, output }, at)
  }

  return {
    async write(step, at) {
      await start(at)
      if ('user' in step) {
        // The response item is the copy the model saw; the event is the turn the user sent.
        await append(
          'response_item',
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: step.user }] },
          at
        )
        await append('event_msg', { type: 'user_message', message: step.user, kind: 'plain' }, at)
        await append('event_msg', { type: 'task_started', model_context_window: 272000 }, at)
      } else if ('agent' in step) {
        lastAgentMessage = step.agent
        await append('event_msg', { type: 'agent_message', message: step.agent }, at)
        await append(
          'response_item',
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: step.agent }]
          },
          at
        )
      } else if ('tool' in step) {
        await call(step.tool.name, step.tool.input, step.tool.output ?? '', at)
      } else if ('edit' in step) {
        const callId = `call_${String(++calls).padStart(6, '0')}`
        await append(
          'response_item',
          {
            type: 'custom_tool_call',
            name: 'apply_patch',
            call_id: callId,
            input: `*** Begin Patch\n*** Update File: ${step.edit}\n@@\n-before\n+after\n*** End Patch`
          },
          at
        )
        await append(
          'response_item',
          {
            type: 'custom_tool_call_output',
            call_id: callId,
            output: 'Success. Updated the file.'
          },
          at
        )
      } else if ('question' in step) {
        const { text, options, answer } = step.question
        const questions = [
          {
            id: 'q1',
            header: 'Choice',
            question: text,
            options: options.map((label) => ({ label }))
          }
        ]
        if (answer === undefined) {
          const callId = `call_${String(++calls).padStart(6, '0')}`
          await append(
            'response_item',
            {
              type: 'function_call',
              name: 'request_user_input',
              arguments: JSON.stringify({ questions }),
              call_id: callId
            },
            at
          )
        } else {
          await call(
            'request_user_input',
            { questions },
            JSON.stringify({ answers: { q1: { answers: [answer] } } }),
            at
          )
        }
      } else if ('subagent' in step) {
        // A Codex helper keeps its own rollout file; the parent holds only the call and its result.
        await call('spawn_agent', { message: step.subagent.prompt }, step.subagent.result, at)
      } else if ('compact' in step) {
        await append('compacted', { message: step.compact }, at)
        await append('event_msg', { type: 'context_compacted' }, at)
      } else if ('injected' in step) {
        await append(
          'response_item',
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `<environment_context>\n${step.injected}\n</environment_context>`
              }
            ]
          },
          at
        )
      } else if (
        'status' in step &&
        (step.status === 'your-turn' || step.status === 'waiting-input')
      ) {
        await append(
          'event_msg',
          { type: 'task_complete', last_agent_message: lastAgentMessage },
          at
        )
      } else {
        return false
      }
      return true
    }
  }
}
