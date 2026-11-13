import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  rmdirSync,
  utimesSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withClaudeConfigLocks } from './seal-claude-config-lock'

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'seal-claude-lock-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('withClaudeConfigLocks', () => {
  it('holds both of Claude Code’s refresh locks while working and releases them after', async () => {
    const home = join(root, 'home')
    const held = await withClaudeConfigLocks([home], async () => [
      existsSync(join(home, '.oauth_refresh.lock')),
      existsSync(`${home}.lock`)
    ])
    expect(held).toEqual([true, true])
    expect(existsSync(join(home, '.oauth_refresh.lock'))).toBe(false)
    expect(existsSync(`${home}.lock`)).toBe(false)
  })

  it('waits for a lock Claude has held for 30s instead of stealing it', async () => {
    const home = join(root, 'home')
    mkdirSync(home)
    mkdirSync(`${home}.lock`)
    // ast-grep-ignore: test-no-wall-clock -- proper-lockfile judges staleness by real mtime against the real clock
    const thirtySecondsAgo = new Date(Date.now() - 30_000)
    utimesSync(`${home}.lock`, thirtySecondsAgo, thirtySecondsAgo)
    let ran = false
    const work = withClaudeConfigLocks([home], async () => {
      ran = true
    })
    // ast-grep-ignore: test-no-real-time-wait -- proving a lock is NOT taken needs a real window for its retries
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(ran).toBe(false)
    rmdirSync(`${home}.lock`)
    await work
    expect(ran).toBe(true)
  })
})
