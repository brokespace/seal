import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
      'No skill named "missing". Available: deploy-site'
    )
  })
})
