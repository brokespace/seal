import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { runLocalScript } from '../hosts/local-shell-script'
import { detachedJobNames } from './detached-shell-jobs'
import { parseDiscoveryOutput } from './discovery-output'
import { buildJobProbeScript } from './discovery-script'

const run = promisify(execFile)
let dir: string | undefined
let job: number | undefined

afterEach(async () => {
  if (job) {
    try {
      process.kill(job)
    } catch {
      // Already gone.
    }
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('a job a shell call left running by itself', () => {
  it('is found among the host’s processes by when it started and what it runs, until it ends', async () => {
    dir = await mkdtemp(join(tmpdir(), 'seal-job-'))
    const script = join(dir, 'fq_cache_build.sh')
    // Blocks in the shell itself, so nothing outlives it.
    await run('mkfifo', [join(dir, 'hold')])
    await writeFile(script, `read -r held < '${join(dir, 'hold')}'\n`)
    const command = `nohup sh ${script} > /dev/null 2>&1 < /dev/null &`
    const from = Math.floor(Date.now() / 1000)
    const { stdout } = await run('/bin/sh', ['-c', `${command} echo $!`])
    job = Number(stdout.trim())
    const until = Math.floor(Date.now() / 1000)
    const names = detachedJobNames(command)
    const asked = [
      // The same command an hour earlier: not this process.
      { from: from - 3600, until: until - 3600, names, noTerminal: false },
      { from, until, names, noTerminal: false }
    ]
    const found = async () =>
      parseDiscoveryOutput(await runLocalScript(buildJobProbeScript(asked))).jobs?.map(
        ({ query, pid, command: runs }) => ({ query, pid, runs })
      )

    expect(names).toEqual(['fq_cache_build.sh'])
    expect(await found()).toEqual([{ query: 1, pid: job, runs: 'sh' }])
    process.kill(job)
    expect(await found()).toEqual([])
  })
})
