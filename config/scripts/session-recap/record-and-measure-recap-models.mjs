#!/usr/bin/env node
// On a host that holds a Workers AI credential: records the model replies the recap scenarios still
// lack, measures the judge on the labelled suite, then replays it all with no network.
// The credential is read by the tests themselves and is never printed. docs/recap-audit/README.md.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..', '..', '..')
const suite = 'src/main/session-recap/scenarios'
const fixtures = join(repo, suite, '__fixtures__')
const evidence = 'docs/recap-audit/evidence'
const env = process.env

function run(command, args, extraEnv = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repo,
    stdio: 'inherit',
    env: { ...env, ...extraEnv },
    shell: process.platform === 'win32'
  })
  return result.status === 0
}

const fromEnv =
  Boolean(env.CLOUDFLARE_ACCOUNT_ID) &&
  Boolean(env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AUTH_TOKEN)
const configFile = join(homedir(), '.config', 'seal', 'cloudflare-ai.json')
if (!fromEnv && !existsSync(configFile)) {
  console.error(
    'No Workers AI credential: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or write ~/.config/seal/cloudflare-ai.json.'
  )
  process.exit(1)
}
console.log(
  `Workers AI credential: ${fromEnv ? 'the environment' : '~/.config/seal/cloudflare-ai.json'}`
)

const recorded = run('pnpm', ['test', suite, '--maxWorkers=1'], {
  RECAP_SCENARIOS_LIVE: '1',
  RECAP_SCENARIOS_REPORT: evidence,
  RECAP_SCENARIOS_UPDATE_BASELINE: '1',
  RECAP_JUDGE_LIVE: '1',
  // Only Clef judges and only its answers are kept, so another candidate is asked only by name.
  RECAP_JUDGE_MODELS: env.RECAP_JUDGE_MODELS ?? 'clef'
})
if (!recorded) {
  console.error(
    '\nThe live run failed. Every answer it got is on record, so running this again asks only for the rest.'
  )
  process.exit(1)
}

// A scenario that has its replies now is checked like the others from here on.
for (const file of readdirSync(join(fixtures, 'scenarios'))) {
  const path = join(fixtures, 'scenarios', file)
  const scenario = JSON.parse(readFileSync(path, 'utf8'))
  if (scenario.pending === true && existsSync(join(fixtures, 'cassettes', file))) {
    delete scenario.pending
    writeFileSync(path, `${JSON.stringify(scenario, null, 2)}\n`)
  }
}

run('pnpm', ['exec', 'oxfmt', '--write', join(suite, '__fixtures__'), `${evidence}/matrix.json`])

if (!run('pnpm', ['test', suite, '--maxWorkers=2'])) {
  console.error(
    '\nThe replay without the network failed: a recorded run is incomplete. Run this again; if it still fails, send the output above.'
  )
  process.exit(1)
}

const report = readFileSync(join(repo, evidence, 'judge', 'report.md'), 'utf8')
console.log(`\n${report.slice(0, report.indexOf('\n## ')).trim()}`)

run('git', ['status', '--short', '--', suite, evidence])
console.log(
  `\nDone. The full report is ${evidence}/judge/report.md. Commit and push what git lists above.`
)
