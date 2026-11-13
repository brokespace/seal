import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { Repo } from '../../../shared/repo-types'
import { discoverSkills } from '../../skills/discovery/skill-native-discovery'
import { readSkillSummary } from '../../skills/discovery/skill-discovery-summary'

export type HomeChatSkill = {
  name: string
  description: string
  /** Where it was found: Seal skills, Claude home, a plugin, a project. */
  source: string
  directoryPath: string
  skillFilePath: string
}

export type HomeChatSkillsDeps = {
  /** Seal's own skills folder: one directory per skill, each with a SKILL.md. */
  sealSkillsDir: string
  homeDir?: string
  repos: () => Repo[]
  discover?: typeof discoverSkills
}

const CACHE_MS = 60_000
const MAX_SKILL_CHARS = 100_000
const MAX_LISTED_FILES = 80

async function listSealSkills(dir: string): Promise<HomeChatSkill[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<HomeChatSkill | null> => {
        const directoryPath = join(dir, entry.name)
        const skillFilePath = join(directoryPath, 'SKILL.md')
        const summary = await readSkillSummary(skillFilePath)
        return summary
          ? {
              name: summary.name ?? entry.name,
              description: summary.description ?? '',
              source: 'Seal skills',
              directoryPath,
              skillFilePath
            }
          : null
      })
  )
  return skills.filter((skill) => skill !== null)
}

async function listFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (out.length >= MAX_LISTED_FILES || entry.name.startsWith('.')) {
      continue
    }
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await listFiles(root, path, out)
    } else if (entry.name !== 'SKILL.md') {
      out.push(relative(root, path))
    }
  }
  return out
}

/** Skills from Seal's folder, Claude Code's home and plugins, and the user's projects. */
export class HomeChatSkills {
  private cache: { at: number; skills: HomeChatSkill[] } | null = null

  constructor(private readonly deps: HomeChatSkillsDeps) {}

  async list(): Promise<HomeChatSkill[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.skills
    }
    const homeDir = this.deps.homeDir ?? homedir()
    const discover = this.deps.discover ?? discoverSkills
    const [own, discovered] = await Promise.all([
      listSealSkills(this.deps.sealSkillsDir),
      // cwd = home so user-scoped Claude plugin skills are included.
      discover({ repos: this.deps.repos(), homeDir, cwd: homeDir, includeCwd: true })
        .then((result) => result.skills)
        .catch(() => [])
    ])
    const seen = new Set<string>()
    const skills: HomeChatSkill[] = []
    const candidates = [
      ...own,
      ...discovered.map((skill) => ({
        name: skill.name,
        description: skill.description ?? '',
        source: skill.sourceLabel,
        directoryPath: skill.directoryPath,
        skillFilePath: skill.skillFilePath
      }))
    ]
    for (const skill of candidates) {
      if (!seen.has(skill.name.toLowerCase())) {
        seen.add(skill.name.toLowerCase())
        skills.push(skill)
      }
    }
    this.cache = { at: Date.now(), skills }
    return skills
  }

  /** The skill's instructions plus the files beside it, for the model to follow. */
  async load(name: string): Promise<string> {
    const wanted = name.trim().toLowerCase()
    const skills = await this.list()
    const skill = skills.find((s) => s.name.toLowerCase() === wanted)
    if (!skill) {
      const known = skills.map((s) => s.name).join(', ')
      throw new Error(`No skill named "${name}". Available: ${known || 'none'}`)
    }
    const body = (await readFile(skill.skillFilePath, 'utf8')).slice(0, MAX_SKILL_CHARS)
    const files = await listFiles(skill.directoryPath)
    const fileList = files.length
      ? `\n\nFiles in the skill folder (read them with read_file on machine "local"):\n${files
          .map((file) => `- ${join(skill.directoryPath, file)}`)
          .join('\n')}`
      : ''
    return `Skill "${skill.name}" from ${skill.source} (${skill.directoryPath}).\nIts instructions use generic tool names; carry them out with your own tools and pick the machine as usual.\n\n${body}${fileList}`
  }

  invalidate(): void {
    this.cache = null
  }
}
