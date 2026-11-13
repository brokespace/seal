import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseShellIntegrationStatus, shellIntegrationScript } from './shell-integration-installer'

const posix = process.platform !== 'win32'
let home: string

async function sh(script: string, env: Record<string, string> = {}) {
  const result = await runProcess({
    program: '/bin/sh',
    args: ['-s'],
    input: script,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...env },
    timeoutMs: 10_000
  })
  return result
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'seal-shell-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe.skipIf(!posix)('shell integration installer', () => {
  it('installs once however often it runs, and uninstall restores the rc file byte for byte', async () => {
    const original = 'alias ll="ls -l"\nexport EDITOR=vim'
    writeFileSync(join(home, '.bashrc'), original)
    await sh(shellIntegrationScript('install'))
    const once = readFileSync(join(home, '.bashrc'), 'utf8')
    const status = parseShellIntegrationStatus((await sh(shellIntegrationScript('install'))).stdout)
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe(once)
    expect(once.match(/function claude/g)).toHaveLength(1)
    expect(status).toMatchObject({ installed: true, enabled: true })
    expect(status?.rcFiles).toContain(join(home, '.bashrc'))

    await sh(shellIntegrationScript('disable'))
    expect(
      parseShellIntegrationStatus((await sh(shellIntegrationScript('status'))).stdout)
    ).toMatchObject({
      installed: true,
      enabled: false
    })

    await sh(shellIntegrationScript('uninstall'))
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe(`${original}\n`)
    expect(
      parseShellIntegrationStatus((await sh(shellIntegrationScript('status'))).stdout)
    ).toMatchObject({
      installed: false,
      rcFiles: []
    })
  })

  it('runs the real binary unchanged, with its args and exit code, when there is no terminal to wrap', async () => {
    await sh(shellIntegrationScript('install'))
    const bin = join(home, 'bin')
    await sh(`mkdir -p "${bin}"`)
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nprintf "%s|" "$@"; pwd; exit 3\n')
    chmodSync(join(bin, 'codex'), 0o755)
    const result = await sh(
      `cd "${home}" && "$HOME/.config/seal/shell/seal-wrap" codex "two  words" "it's" </dev/null`,
      { PATH: `${bin}:${process.env.PATH}` }
    )
    expect(result.stdout.trim()).toBe(`two  words|it's|${home}`)
    expect(result.code).toBe(3)
  })
})
