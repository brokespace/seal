import { expect } from '@stablyai/playwright-test'
import { exists, expectError, expectOk, jobIdIn, q, seedFile, workDir } from './tool-case-support'
import type { Target, ToolCases, ToolEnv } from './tool-case-types'

const TRICKY_SCRIPT = [
  'v="two  words"',
  `printf '%s|%s|%s\\n' "$v" '$HOME * \`x\` !bang' "it's \\"quoted\\""`,
  'echo "unicode: zażółć 日本語 🦭"',
  "printf 'tab\\there \\\\ backslash\\n'",
  "cat <<'EOF'",
  '$not_expanded "in" a here-document',
  'EOF',
  'echo to-stderr >&2'
].join('\n')

const TRICKY_OUTPUT = [
  'two  words|$HOME * `x` !bang|it\'s "quoted"',
  'unicode: zażółć 日本語 🦭',
  'tab\there \\ backslash',
  '$not_expanded "in" a here-document',
  'to-stderr'
].join('\n')

async function noticeAbout(env: ToolEnv, chatId: string, jobId: string): Promise<string> {
  let text = ''
  await expect
    .poll(
      async () => {
        const entries = await env.page.evaluate(
          async (chat) => (await window.api.homeChat!.get({ chatId: chat }))?.entries ?? [],
          chatId
        )
        text =
          entries.flatMap((entry) =>
            entry.kind === 'notice' && entry.text.includes(jobId) ? [entry.text] : []
          )[0] ?? ''
        return text
      },
      { timeout: 60_000, message: `no notice arrived for job ${jobId}` }
    )
    .not.toBe('')
  return text
}

async function runCommand(env: ToolEnv, target: Target): Promise<void> {
  const dir = workDir(target)
  for (const name of ['a 1.txt', 'b.txt', 'c.log']) {
    seedFile(target, `${dir}/globs/${name}`, 'x')
  }
  const { outcomes, chatId } = await env.call(
    [
      { name: 'run_command', args: { machine: target.machine, command: TRICKY_SCRIPT } },
      {
        name: 'run_command',
        args: {
          machine: target.machine,
          cwd: `${dir}/globs`,
          command: 'ls *.txt; echo *.nomatch; pwd'
        }
      },
      {
        name: 'run_command',
        args: { machine: target.machine, command: 'echo out; echo err >&2; exit 42' }
      },
      {
        name: 'run_command',
        args: {
          machine: target.machine,
          command: 'echo "$SEAL_E2E_PROFILE"; cat; echo stdin-empty'
        }
      },
      { name: 'run_command', args: { machine: target.machine, command: 'seq 1 20000' } },
      (answers) => ({
        name: 'job_output',
        args: { job_id: /job_id (\w+)/.exec(answers[4])?.[1] ?? '', offset: 0, max_bytes: 100 }
      }),
      (answers) => ({
        name: 'job_cleanup',
        args: { job_id: /job_id (\w+)/.exec(answers[4])?.[1] ?? '' }
      }),
      {
        name: 'run_command',
        args: {
          machine: target.machine,
          command: 'echo started; sleep 3; echo finished; exit 5',
          timeout_seconds: 1
        }
      },
      {
        name: 'run_command',
        args: { machine: target.machine, cwd: `${dir}/missing`, command: 'pwd' }
      }
    ],
    { timeoutMs: 180_000 }
  )
  expect(expectOk(outcomes[0])).toBe(`exit code 0\n\noutput (stdout+stderr):\n${TRICKY_OUTPUT}`)
  expect(expectOk(outcomes[1])).toBe(
    `exit code 0\n\noutput (stdout+stderr):\na 1.txt\nb.txt\n*.nomatch\n${dir}/globs`
  )
  expect(expectError(outcomes[2])).toBe('exit code 42\n\noutput (stdout+stderr):\nout\nerr')
  expect(expectOk(outcomes[3])).toBe(
    `exit code 0\n\noutput (stdout+stderr):\nprofile-of-${target.key}\nstdin-empty`
  )

  const large = expectOk(outcomes[4])
  expect(large).toMatch(
    /^exit code 0\n\noutput \(stdout\+stderr\):\n\[last 30000 of 108894 bytes; job_output with job_id \w+ reads the rest\]\n/
  )
  expect(large.endsWith('\n19999\n20000')).toBe(true)
  expect(expectOk(outcomes[5]).startsWith('1\n2\n3\n4\n5\n')).toBe(true)
  const keptJob = /job_id (\w+)/.exec(large)![1]
  expect(expectOk(outcomes[6])).toBe(`Removed job ${keptJob}'s folder.`)
  expect(exists(target, `${target.home}/.seal/jobs/${keptJob}`)).toBe(false)

  const slow = expectOk(outcomes[7])
  expect(slow).toContain('Still running after 1s, so it continues as background job')
  expect(slow).toContain('started')
  expect(slow).not.toContain('finished')
  const notice = await noticeAbout(env, chatId, jobIdIn(slow))
  expect(notice).toContain('exited with code 5')
  expect(notice).toContain('finished')

  expect(expectError(outcomes[8])).toContain('missing')
}

async function jobStatus(env: ToolEnv, target: Target): Promise<void> {
  const { outcomes } = await env.call([
    {
      name: 'run_command',
      args: { machine: target.machine, command: 'echo ready; sleep 120', background: true }
    },
    (answers) => ({ name: 'job_status', args: { job_id: jobIdIn(answers[0]) } }),
    { name: 'job_status', args: {} },
    (answers) => ({ name: 'job_kill', args: { job_id: jobIdIn(answers[0]) } }),
    (answers) => ({ name: 'job_status', args: { job_id: jobIdIn(answers[0]) } })
  ])
  const started = expectOk(outcomes[0])
  const id = jobIdIn(started)
  expect(started).toContain(`Started background job ${id} on ${target.label}.`)
  const live = expectOk(outcomes[1])
  expect(live).toMatch(new RegExp(`^Job ${id} on .*: running \\(pid \\d+\\)\\.`))
  expect(live).toContain('ready')
  expect(expectOk(outcomes[2])).toMatch(new RegExp(`^${id} on .*: running, started `))
  expectOk(outcomes[3])
  expect(expectOk(outcomes[4])).toContain(`Job ${id} on ${target.label}: exited with code 143.`)
}

async function jobOutput(env: ToolEnv, target: Target): Promise<void> {
  const { outcomes } = await env.call([
    {
      name: 'run_command',
      args: {
        machine: target.machine,
        command: 'i=1; while [ $i -le 300 ]; do echo "line $i ü"; i=$((i+1)); done; sleep 120',
        background: true
      }
    },
    (answers) => ({ name: 'job_output', args: { job_id: jobIdIn(answers[0]), max_bytes: 100 } }),
    (answers) => ({
      name: 'job_output',
      args: { job_id: jobIdIn(answers[0]), offset: 0, max_bytes: 100 }
    }),
    (answers) => ({ name: 'job_kill', args: { job_id: jobIdIn(answers[0]) } })
  ])
  const tail = expectOk(outcomes[1])
  expect(tail.startsWith('[3492 bytes total, showing the last 100]\n')).toBe(true)
  expect(tail.endsWith('line 299 ü\nline 300 ü\n')).toBe(true)
  expect(expectOk(outcomes[2]).startsWith('line 1 ü\nline 2 ü\nline 3 ü\n')).toBe(true)
  expectOk(outcomes[3])
}

async function jobKill(env: ToolEnv, target: Target): Promise<void> {
  // The sleep lengths name this machine's job, so its processes can be found from outside.
  const mark = 61_000 + env.targets.indexOf(target) * 10
  const running = (): string => target.sh(`pgrep -f 'sleep ${mark}[12]' || true`).toString().trim()
  const { outcomes } = await env.call([
    {
      name: 'run_command',
      args: {
        machine: target.machine,
        command: `sleep ${mark}1 & sleep ${mark}2; wait`,
        background: true
      }
    },
    (answers) => {
      expect(running().split('\n')).toHaveLength(2)
      return { name: 'job_kill', args: { job_id: jobIdIn(answers[0]) } }
    }
  ])
  const id = jobIdIn(expectOk(outcomes[0]))
  expect(expectOk(outcomes[1])).toBe(`Stopped job ${id} on ${target.label}.`)
  expect(running()).toBe('')
}

async function jobCleanup(env: ToolEnv, target: Target): Promise<void> {
  const folder = (id: string): string => `${target.home}/.seal/jobs/${id}`
  const { outcomes } = await env.call([
    {
      name: 'run_command',
      args: { machine: target.machine, command: 'echo cleanup-me; sleep 2', background: true }
    },
    (answers) => {
      const id = jobIdIn(answers[0])
      // The job has ended once its exit code is on disk.
      target.sh(
        `i=0; while [ ! -f ${q(`${folder(id)}/exit`)} ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done`
      )
      return { name: 'job_status', args: { job_id: id } }
    },
    (answers) => {
      expect(exists(target, folder(jobIdIn(answers[0])))).toBe(true)
      return { name: 'job_cleanup', args: { job_id: jobIdIn(answers[0]) } }
    }
  ])
  const id = jobIdIn(expectOk(outcomes[0]))
  expect(expectOk(outcomes[1])).toContain('exited with code 0')
  expect(expectOk(outcomes[1])).toContain('cleanup-me')
  expect(expectOk(outcomes[2])).toBe(`Removed job ${id}'s folder.`)
  expect(exists(target, folder(id))).toBe(false)
}

export const COMMAND_TOOL_CASES: ToolCases = {
  run_command: { scope: 'each-machine', run: runCommand },
  job_status: { scope: 'each-machine', run: jobStatus },
  job_output: { scope: 'each-machine', run: jobOutput },
  job_kill: { scope: 'each-machine', run: jobKill },
  job_cleanup: { scope: 'each-machine', run: jobCleanup }
}
