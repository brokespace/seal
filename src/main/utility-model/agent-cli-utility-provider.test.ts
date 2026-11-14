import { describe, expect, it, vi } from 'vitest'
import {
  agentCliPrompt,
  createAgentCliUtilityProvider,
  type AgentCliUtilityRun
} from './agent-cli-utility-provider'
import { UtilityModelError } from './utility-model-provider'

const REQUEST = {
  messages: [
    { role: 'system' as const, content: 'Write one sentence.' },
    { role: 'user' as const, content: 'The agent stopped after the tests failed.' }
  ],
  maxTokens: 48
}

function providerRunning(run: AgentCliUtilityRun) {
  const spy = vi.fn(run)
  const provider = createAgentCliUtilityProvider('claude', {
    environment: () => undefined,
    commandOverride: () => '/opt/bin/claude',
    accountEnvironment: () => ({}),
    run: spy
  })
  return { provider, run: spy }
}

async function failureOf(run: Promise<unknown>): Promise<UtilityModelError> {
  const error = await run.then(
    () => null,
    (thrown: unknown) => thrown
  )
  if (!(error instanceof UtilityModelError)) {
    throw new Error('expected a UtilityModelError')
  }
  return error
}

describe('agent CLI utility provider', () => {
  it('hands the CLI one prompt, the chosen model and the command from Settings', async () => {
    const { provider, run } = providerRunning(async () => ({
      success: true,
      rawOutput: 'Tests failed; waiting on you.'
    }))

    const reply = await provider.complete('haiku', REQUEST)

    expect(reply).toBe('Tests failed; waiting on you.')
    expect(run.mock.calls[0][0]).toMatchObject({
      agent: 'claude',
      model: 'haiku',
      commandOverride: '/opt/bin/claude',
      prompt: agentCliPrompt(REQUEST)
    })
    expect(agentCliPrompt(REQUEST)).toBe(
      'Answer with the requested text only. Do not use tools, read files, or ask questions.\n\n' +
        'Write one sentence.\n\n' +
        'The agent stopped after the tests failed.'
    )
  })

  it('reads a missing CLI as not configured', async () => {
    const { provider } = providerRunning(async () => ({
      success: false,
      error: 'claude not found on PATH. Install Claude to use AI commit messages.',
      errorCode: 'agentBinaryNotFound'
    }))

    expect((await failureOf(provider.complete('haiku', REQUEST))).kind).toBe('not-configured')
  })

  it.each([
    ['Claude usage limit reached. Your limit will reset at 4pm.', 'rate-limited'],
    ['Invalid API key · Please run /login', 'unauthorized'],
    ['The model `nope` does not exist or you do not have access to it.', 'model-not-found'],
    ['Segmentation fault', 'bad-response']
  ] as const)('reads the CLI saying "%s" as %s', async (stderr, kind) => {
    const { provider } = providerRunning(async () => ({
      success: false,
      error: 'Claude CLI command failed with code 1.',
      failureOutput: { label: 'Claude', exitCode: 1, stdout: '', stderr }
    }))

    const failure = await failureOf(provider.complete('haiku', REQUEST))

    expect(failure.kind).toBe(kind)
    expect(failure.detail.model).toBe('haiku')
  })

  it('runs one CLI at a time', async () => {
    const finish: (() => void)[] = []
    const { provider, run } = providerRunning(
      () =>
        new Promise((resolve) => {
          finish.push(() => resolve({ success: true, rawOutput: 'ok' }))
        })
    )

    const both = Promise.all([
      provider.complete('haiku', REQUEST),
      provider.complete('haiku', REQUEST)
    ])
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await expect(
      vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2), { timeout: 50 })
    ).rejects.toThrow()
    finish[0]()
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    finish[1]()

    expect(await both).toEqual(['ok', 'ok'])
  })
})
