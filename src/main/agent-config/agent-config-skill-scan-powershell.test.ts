import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeSkillFixtureHome } from './testing/agent-config-skill-fixture-trees'
import { scanMachineFiles, type MachineFileScanRunner } from '../machines/scan/machine-file-scan'

function hasPowerShell(): boolean {
  try {
    execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Windows machines answer through PowerShell; this runs the same script in a real one.
describe.skipIf(process.platform === 'win32' || !hasPowerShell())('file scan in PowerShell', () => {
  let home: string

  beforeEach(async () => {
    home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seal-scan-pwsh-')))
    await writeSkillFixtureHome(home)
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const runner = (): MachineFileScanRunner => ({
    dialect: 'powershell',
    exec: async (script) => {
      const { stdout, stderr } = await promisify(execFile)(
        'pwsh',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { env: { ...process.env, USERPROFILE: home, HOME: home }, maxBuffer: 8 * 1024 * 1024 }
      )
      return { exitCode: 0, stdout, stderr }
    }
  })

  it('finds grouped, linked and hidden skill folders, and skips dependency trees', async () => {
    const scan = await scanMachineFiles(runner(), {
      skillRoots: [
        { tag: 'claude', dir: '~/.claude/skills' },
        { tag: 'codex', dir: '~/.codex/skills', maxDepth: 5 },
        { tag: 'agents', dir: '~/.agents/skills', maxDepth: 5 },
        { tag: 'missing', dir: '~/.qwen/skills' }
      ],
      named: [
        {
          tag: 'plugin',
          root: '~/.claude/plugins/cache/local-mkt/hello/1.0.0',
          names: ['SKILL.md', 'plugin.json'],
          maxDepth: 7,
          skipDirs: ['node_modules', '.git'],
          followLinks: true,
          includeHidden: true
        }
      ],
      headBytes: 4096
    })

    expect(scan.home).toBe(home)
    expect(scan.records.map((record) => [record.tag, path.relative(home, record.path)])).toEqual([
      ['claude', '.claude/skills/shared-kit/SKILL.md'],
      ['codex', '.codex/skills/.system/imagegen/SKILL.md'],
      ['codex', '.codex/skills/ops/rollback/SKILL.md'],
      ['agents', '.agents/skills/notes/SKILL.md'],
      ['agents', '.agents/skills/shared-kit/SKILL.md'],
      ['plugin', '.claude/plugins/cache/local-mkt/hello/1.0.0/.claude-plugin/plugin.json'],
      ['plugin', '.claude/plugins/cache/local-mkt/hello/1.0.0/extra/wave/SKILL.md'],
      ['plugin', '.claude/plugins/cache/local-mkt/hello/1.0.0/skills/greet/reference/SKILL.md'],
      ['plugin', '.claude/plugins/cache/local-mkt/hello/1.0.0/skills/greet/SKILL.md']
    ])
    expect(scan.records.find((record) => record.path.endsWith('rollback/SKILL.md'))?.head).toBe(
      '---\nname: rollback\ndescription: Roll a release back.\n---\n\n# rollback\n'
    )
  })
})
