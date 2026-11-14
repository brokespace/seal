import { expect } from '@stablyai/playwright-test'
import { expectError, expectOk, readBack, sharedFlow, waitUntilIdle } from './tool-case-support'
import type { ToolCases, ToolEnv } from './tool-case-types'

const TITLE = 'Check the "zsh" box'
const PROOF_TEXT = 'the worker was here ✓\n'

/** A background copy of the assistant does real work on a machine, then is steered and stopped. */
const workerFlow = sharedFlow(async (env) => {
  const remote = env.targets.find((target) => target.key === 'ssh-zsh')!
  const proof = `${remote.home}/seal-e2e-worker.txt`
  const work = env.script([
    { name: 'write_file', args: { machine: remote.machine, path: proof, content: PROOF_TEXT } }
  ])
  const started = await env.call([
    {
      name: 'spawn_subagent',
      args: { mode: 'assistant', title: TITLE, task: `Leave the proof file. ${work.text}` }
    },
    {
      name: 'spawn_subagent',
      args: { mode: 'agent', title: 'No project given', task: 'Fix the tests.' }
    }
  ])
  await expect
    .poll(() => remote.sh(`cat '${proof}' 2>/dev/null || true`).toString(), { timeout: 60_000 })
    .toBe(PROOF_TEXT)
  // The worker's finish wakes this thread; let that turn end before asking more of it.
  await expect
    .poll(
      async () =>
        (
          await env.page.evaluate(
            async (chat) => (await window.api.homeChat!.get({ chatId: chat }))?.entries ?? [],
            started.chatId
          )
        ).some((entry) => entry.kind === 'notice' && entry.source === 'subagent'),
      { timeout: 60_000 }
    )
    .toBe(true)
  await waitUntilIdle(env, started.chatId)
  const id = /worker (\w+)/.exec(started.outcomes[0]?.text ?? '')?.[1] ?? ''
  const followed = await env.call(
    [
      { name: 'check_subagent', args: {} },
      { name: 'check_subagent', args: { id } },
      { name: 'message_subagent', args: { id, text: 'One more thing: say "hi".' } },
      { name: 'stop_subagent', args: { id } },
      { name: 'check_subagent', args: { id: 'no-such-worker' } },
      { name: 'message_subagent', args: { id: 'no-such-worker', text: 'hello' } },
      { name: 'stop_subagent', args: { id: 'no-such-worker' } }
    ],
    { chatId: started.chatId }
  )
  return {
    id,
    proof: readBack(remote, proof).toString('utf8'),
    finishedText: work.finishedText,
    started: started.outcomes,
    followed: followed.outcomes
  }
})

async function spawnSubagent(env: ToolEnv): Promise<void> {
  const flow = await workerFlow(env)
  expect(expectOk(flow.started[0])).toBe(
    `Started assistant worker ${flow.id} ("${TITLE}"). You will get a notice here when it finishes; keep helping the user meanwhile.`
  )
  expect(flow.proof).toBe(PROOF_TEXT)
  expect(expectError(flow.started[1])).toContain('Agent mode needs a project')
}

async function checkSubagent(env: ToolEnv): Promise<void> {
  const flow = await workerFlow(env)
  expect(expectOk(flow.followed[0])).toContain(`${flow.id} "${TITLE}": idle, assistant worker`)
  const one = expectOk(flow.followed[1])
  expect(one).toContain('worker is idle')
  expect(one).toContain(`latest answer:\n${flow.finishedText}`)
  expectError(flow.followed[4])
}

async function messageSubagent(env: ToolEnv): Promise<void> {
  const flow = await workerFlow(env)
  expect(expectOk(flow.followed[2])).toBe(`Sent to ${flow.id}; it will report back when idle.`)
  expectError(flow.followed[5])
}

async function stopSubagent(env: ToolEnv): Promise<void> {
  const flow = await workerFlow(env)
  expect(expectOk(flow.followed[3])).toMatch(
    new RegExp(`^Stopped ${flow.id} "Check the "zsh" box": stopped, assistant worker`)
  )
  expectError(flow.followed[6])
}

async function activeView(env: ToolEnv): Promise<string | undefined> {
  return env.page.evaluate(() => window.__store?.getState().activeView)
}

/** The window follows wherever it is: each request is made from the page the last one opened. */
async function openInSeal(env: ToolEnv): Promise<void> {
  const remote = env.targets.find((target) => target.key === 'ssh-bash')!
  const sessions = await env.call([{ name: 'open_in_seal', args: { target: 'sessions' } }])
  expect(expectOk(sessions.outcomes[0])).toBe('Showing sessions in Seal.')
  await expect.poll(() => activeView(env)).toBe('sessions')

  const machine = await env.call([
    { name: 'open_in_seal', args: { target: 'machine', id: remote.machine } }
  ])
  expect(expectOk(machine.outcomes[0])).toBe(`Showing ${remote.label} on the Machines page.`)
  await expect.poll(() => activeView(env)).toBe('machines')
  // The narrow detail header can squeeze the name to nothing, so presence is what is checked.
  await expect(env.page.getByRole('heading', { name: remote.label })).toHaveCount(1)

  const thread = await env.call([
    { name: 'open_in_seal', args: { target: 'thread', id: sessions.chatId } },
    { name: 'open_in_seal', args: { target: 'thread' } }
  ])
  expect(expectOk(thread.outcomes[0])).toBe('Showing that thread.')
  expect(expectError(thread.outcomes[1])).toContain('needs id')
  await expect.poll(() => activeView(env)).toBe('home')
}

export const DELEGATION_TOOL_CASES: ToolCases = {
  spawn_subagent: { scope: 'app', run: spawnSubagent },
  check_subagent: { scope: 'app', run: checkSubagent },
  message_subagent: { scope: 'app', run: messageSubagent },
  stop_subagent: { scope: 'app', run: stopSubagent },
  open_in_seal: { scope: 'app', run: openInSeal }
}
