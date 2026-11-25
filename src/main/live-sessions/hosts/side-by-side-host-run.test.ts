import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localHost, type LiveSessionHost } from './live-session-hosts'
import { sideBySideHosts } from './side-by-side-host-run'

let dir: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'seal-side-by-side-')))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('scripts asked of a machine in one turn', () => {
  it('run side by side in one run, each with its own output back', async () => {
    const scripts: string[] = []
    const local = localHost('mbp')
    const host: LiveSessionHost = {
      ...local,
      run: (script) => {
        scripts.push(script)
        return local.run(script)
      }
    }
    const { run } = sideBySideHosts()(host)!
    const flag = join(dir, 'second-ran')

    // The first ends only once the second has run: one after the other, it never would.
    const outputs = await Promise.all([
      run(`while [ ! -e '${flag}' ]; do sleep 0.05; done\necho first\necho done`),
      run(`case x in *x*) : > '${flag}'; echo second ;; esac`)
    ])

    expect(outputs).toEqual(['first\ndone\n', 'second\n'])
    expect(scripts).toHaveLength(1)
  })
})
