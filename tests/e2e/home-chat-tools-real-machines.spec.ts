// Every Home assistant tool, run by the real app against real machines: this computer, accounts
// behind a real sshd (zsh, bash and fish login shells) and a paired Seal server. Only the model is
// scripted; it asks for each tool with the JSON arguments a model would send.
import { writeFileSync } from 'node:fs'
import { expect, test } from './helpers/orca-app'
import { localSshdUnavailableReason } from './helpers/local-sshd-machines'
import {
  HOME_CHAT_TOOLS,
  type HomeChatToolName
} from '../../src/main/home-chat/tools/home-chat-tool-definitions'
import { ACCOUNT_TOOL_CASES } from './home-chat-tools/account-tool-cases'
import { ASSISTANT_TOOL_CASES } from './home-chat-tools/assistant-tool-cases'
import { COMMAND_TOOL_CASES } from './home-chat-tools/command-tool-cases'
import { DELEGATION_TOOL_CASES } from './home-chat-tools/delegation-tool-cases'
import { FILE_TOOL_CASES } from './home-chat-tools/file-tool-cases'
import { SESSION_TOOL_CASES } from './home-chat-tools/session-tool-cases'
import { SKILL_TOOL_CASES } from './home-chat-tools/skill-tool-cases'
import { launchHomeChatOnRealMachines } from './home-chat-tools/real-machine-targets'
import type { TargetKey, ToolCases } from './home-chat-tools/tool-case-types'

const CASES: ToolCases = {
  ...COMMAND_TOOL_CASES,
  ...FILE_TOOL_CASES,
  ...SKILL_TOOL_CASES,
  ...ASSISTANT_TOOL_CASES,
  ...DELEGATION_TOOL_CASES,
  ...SESSION_TOOL_CASES,
  ...ACCOUNT_TOOL_CASES
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the keys of the registry are its tool names.
const TOOL_NAMES = Object.keys(HOME_CHAT_TOOLS) as HomeChatToolName[]

type Cell = 'pass' | 'fail' | 'n/a'
type Matrix = Record<string, Partial<Record<TargetKey, Cell>>>

function failureText(error: unknown): string {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
  // oxlint-disable-next-line no-control-regex -- strips the reporter's colour codes.
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

test('every tool in the registry has an end-to-end case', () => {
  expect(TOOL_NAMES.filter((name) => !CASES[name])).toEqual([])
  expect(Object.keys(CASES).filter((name) => !Object.hasOwn(HOME_CHAT_TOOLS, name))).toEqual([])
})

test('every Home assistant tool works on this computer, over SSH and through a Seal server', async ({
  testRepoPath
}, testInfo) => {
  const unavailable = localSshdUnavailableReason()
  // A developer machine without sudo cannot host the accounts; CI must never skip them.
  test.skip(unavailable !== null && !process.env.CI, unavailable ?? '')
  expect(unavailable, 'CI must be able to run a real sshd').toBeNull()
  // Thirty-three tools on five machines, each a real assistant turn; a healthy run takes two minutes.
  test.setTimeout(30 * 60_000)

  const only = (process.env.SEAL_HOME_CHAT_TOOL_FILTER ?? '').split(',').filter(Boolean)
  const suite = await launchHomeChatOnRealMachines(testInfo, testRepoPath)
  const matrix: Matrix = {}
  const failures: string[] = []
  try {
    const { env } = suite
    for (const tool of TOOL_NAMES) {
      const toolCase = CASES[tool]
      if (!toolCase || (only.length > 0 && !only.includes(tool))) {
        continue
      }
      matrix[tool] = {}
      await test.step(tool, async () => {
        const runs =
          toolCase.scope === 'app'
            ? [{ key: env.targets[0].key, run: () => toolCase.run(env) }]
            : env.targets
                .filter(
                  (target) => toolCase.scope === 'each-machine' || toolCase.on.includes(target.key)
                )
                .map((target) => ({ key: target.key, run: () => toolCase.run(env, target) }))
        for (const target of env.targets) {
          matrix[tool][target.key] = 'n/a'
        }
        for (const { key, run } of runs) {
          try {
            await run()
            matrix[tool][key] = 'pass'
          } catch (error) {
            matrix[tool][key] = 'fail'
            failures.push(`${tool} on ${key}:\n${failureText(error)}`)
          }
        }
      })
    }
  } finally {
    await suite.dispose()
    const report = testInfo.outputPath('home-chat-tool-matrix.json')
    writeFileSync(report, JSON.stringify(matrix, null, 2))
    await testInfo.attach('home-chat-tool-matrix', {
      path: report,
      contentType: 'application/json'
    })
    if (process.env.SEAL_HOME_CHAT_TOOL_MATRIX_FILE) {
      writeFileSync(process.env.SEAL_HOME_CHAT_TOOL_MATRIX_FILE, JSON.stringify(matrix, null, 2))
    }
  }
  expect(failures.join('\n\n')).toBe('')
})
