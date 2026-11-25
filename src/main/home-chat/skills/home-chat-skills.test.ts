import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalMachine } from '../machines/home-chat-local-machine'
import type { HomeChatMachine } from '../machines/home-chat-machine-types'
import { HomeChatSkills } from './home-chat-skills'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'home-chat-skills-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeSkill(
  dir: string,
  name: string,
  description: string,
  body: string
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`
  )
}

describe('HomeChatSkills', () => {
  it('lists Seal skills and loads one with the files beside it', async () => {
    const sealSkillsDir = join(root, 'seal-skills')
    await writeSkill(
      join(sealSkillsDir, 'deploy'),
      'deploy-site',
      'Deploy the website',
      'Run the deploy script.'
    )
    await writeFile(join(sealSkillsDir, 'deploy', 'deploy.sh'), 'echo deploy')
    const skills = new HomeChatSkills({
      sealSkillsDir,
      homeDir: join(root, 'home'),
      repos: () => [],
      discover: () => Promise.resolve({ skills: [], sources: [], scannedAt: 0 })
    })

    expect((await skills.list()).map((s) => [s.name, s.description, s.source])).toEqual([
      ['deploy-site', 'Deploy the website', 'Seal skills']
    ])
    const loaded = await skills.load('Deploy-Site')
    expect(loaded).toContain('Run the deploy script.')
    expect(loaded).toContain(join(sealSkillsDir, 'deploy', 'deploy.sh'))
    await expect(skills.load('missing')).rejects.toThrow(
      'No skill named "missing" on this computer. Available: deploy-site.'
    )
  })

  it.skipIf(process.platform === 'win32')(
    'discovers the skills and instructions on another machine and loads one from there',
    async () => {
      // This computer's shell stands in for the remote one; its home is the temp folder.
      const home = join(root, 'remote-home')
      const originalHome = process.env.HOME
      process.env.HOME = home
      try {
        await writeSkill(
          join(home, '.claude', 'skills', 'gpu-check'),
          'gpu-check',
          'Check GPU health on the training rig',
          'Run nvidia-smi and report temperatures.'
        )
        await writeFile(join(home, '.claude', 'skills', 'gpu-check', 'thresholds.json'), '{}')
        await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Always use tabs.')
        const machine: HomeChatMachine = {
          ...createLocalMachine(),
          info: {
            id: 'machine:kessel',
            label: 'kessel-ml',
            kind: 'remote',
            connected: true,
            status: 'online'
          }
        }
        const skills = new HomeChatSkills({
          sealSkillsDir: join(root, 'none'),
          homeDir: join(root, 'local-home'),
          repos: () => [],
          discover: () => Promise.resolve({ skills: [], sources: [], scannedAt: 0 })
        })

        const catalog = await skills.machineCatalog(machine)
        expect(catalog.entries.map((e) => [e.kind, e.name, e.description])).toEqual([
          ['skill', 'gpu-check', 'Check GPU health on the training rig'],
          ['instructions', 'CLAUDE', '']
        ])
        const loaded = await skills.load('gpu-check', machine)
        expect(loaded).toContain('Run nvidia-smi and report temperatures.')
        expect(loaded).toContain(join(home, '.claude', 'skills', 'gpu-check', 'thresholds.json'))
        expect(loaded).toContain('on machine "machine:kessel"')
      } finally {
        process.env.HOME = originalHome
      }
    }
  )
})
