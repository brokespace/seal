import { access, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { getRepoRoutingConnectionId } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'
import { discoverSkills } from '../../skills/discovery/skill-native-discovery'
import { readSkillSummary } from '../../skills/discovery/skill-discovery-summary'
import {
  LOCAL_MACHINE_ID,
  type HomeChatMachine,
  type HomeChatMachineProvider
} from '../machines/home-chat-machine-types'
import {
  discoverMachineCatalog,
  listSkillFolder,
  type HomeChatCatalogEntry,
  type HomeChatMachineCatalog
} from './home-chat-machine-catalog'

export type HomeChatSkill = {
  name: string
  description: string
  /** Where it was found: Seal skills, Claude home, a plugin, a project. */
  source: string
  directoryPath: string
  skillFilePath: string
}

export type HomeChatInstructionText = { path: string; text: string; truncated: boolean }

export type HomeChatProjectInstructions = { project: string; files: string[] }

export type HomeChatSkillsDeps = {
  /** Seal's own skills folder: one directory per skill, each with a SKILL.md. */
  sealSkillsDir: string
  homeDir?: string
  repos: () => Repo[]
  discover?: typeof discoverSkills
}

const CACHE_MS = 60_000
const REMOTE_CACHE_MS = 5 * 60_000
/** Building the prompt never waits longer than this for other machines to answer. */
const REMOTE_DISCOVERY_WAIT_MS = 2_500
const MAX_SKILL_CHARS = 100_000
const MAX_INSTRUCTION_CHARS = 8_000
const MAX_LISTED_FILES = 80
const HOME_INSTRUCTION_FILES = [
  ['.claude', 'CLAUDE.md'],
  ['.codex', 'AGENTS.md']
]
const PROJECT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', join('.claude', 'skills')]

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

function skillText(
  name: string,
  where: string,
  machine: string,
  body: string,
  files: readonly string[]
): string {
  const fileList = files.length
    ? `\n\nFiles in the skill folder (read them with read_file on machine "${machine}"):\n${files
        .map((file) => `- ${file}`)
        .join('\n')}`
    : ''
  return `Skill "${name}" from ${where}.\nIts instructions use generic tool names; carry them out with your own tools and pick the machine as usual.\n\n${body}${fileList}`
}

/** Skills and instruction files on this computer and, discovered on demand, on every other machine. */
export class HomeChatSkills {
  private cache: { at: number; skills: HomeChatSkill[] } | null = null
  private readonly remote = new Map<string, HomeChatMachineCatalog>()
  private readonly discovering = new Map<string, Promise<HomeChatMachineCatalog>>()

  constructor(private readonly deps: HomeChatSkillsDeps) {}

  private get home(): string {
    return this.deps.homeDir ?? homedir()
  }

  /** Skills on this computer: Seal's folder, the agents' homes and plugins, and local projects. */
  async list(): Promise<HomeChatSkill[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.skills
    }
    const discover = this.deps.discover ?? discoverSkills
    const [own, discovered] = await Promise.all([
      listSealSkills(this.deps.sealSkillsDir),
      // cwd = home so user-scoped Claude plugin skills are included.
      discover({ repos: this.deps.repos(), homeDir: this.home, cwd: this.home, includeCwd: true })
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

  /** The user's own standing instructions for their agents on this computer. */
  async localInstructions(): Promise<HomeChatInstructionText[]> {
    const files = await Promise.all(
      HOME_INSTRUCTION_FILES.map(async (parts): Promise<HomeChatInstructionText | null> => {
        const path = join(this.home, ...parts)
        const text = await readFile(path, 'utf8').catch(() => null)
        return text?.trim()
          ? {
              path,
              text: text.slice(0, MAX_INSTRUCTION_CHARS),
              truncated: text.length > MAX_INSTRUCTION_CHARS
            }
          : null
      })
    )
    return files.filter((file) => file !== null)
  }

  /** Which local projects carry their own instructions; the model reads them before working there. */
  async projectInstructions(): Promise<HomeChatProjectInstructions[]> {
    const projects = await Promise.all(
      this.deps
        .repos()
        .filter((repo) => !getRepoRoutingConnectionId(repo))
        .map(async (repo): Promise<HomeChatProjectInstructions> => {
          const present = await Promise.all(
            PROJECT_INSTRUCTION_FILES.map((file) =>
              access(join(repo.path, file)).then(
                () => join(repo.path, file),
                () => null
              )
            )
          )
          return { project: repo.path, files: present.filter((file) => file !== null) }
        })
    )
    return projects.filter((project) => project.files.length > 0)
  }

  /**
   * Discover what a machine has. The system prompt takes a recent result; a tool call asks with
   * `fresh`, so a skill installed a minute ago is found.
   */
  async machineCatalog(
    machine: HomeChatMachine,
    projectPath?: string,
    fresh = false
  ): Promise<HomeChatMachineCatalog> {
    if (projectPath) {
      return discoverMachineCatalog(machine, projectPath)
    }
    const id = machine.info.id
    const cached = this.remote.get(id)
    if (!fresh && cached && Date.now() - cached.at < REMOTE_CACHE_MS) {
      return cached
    }
    let pending = this.discovering.get(id)
    if (!pending) {
      pending = discoverMachineCatalog(machine)
        .then((catalog) => {
          this.remote.set(id, catalog)
          return catalog
        })
        .finally(() => this.discovering.delete(id))
      this.discovering.set(id, pending)
    }
    return pending
  }

  /**
   * Catalogs of the other machines that are reachable right now, for the system prompt. Slow or
   * failing machines are skipped this turn and picked up once their discovery lands.
   */
  async remoteCatalogs(machines: HomeChatMachineProvider): Promise<HomeChatMachineCatalog[]> {
    const online = (await machines.list()).filter(
      (info) => info.id !== LOCAL_MACHINE_ID && info.connected
    )
    const work = Promise.allSettled(
      online.map(async (info) => this.machineCatalog(await machines.open(info.id)))
    )
    await Promise.race([
      work,
      new Promise((resolve) => setTimeout(resolve, REMOTE_DISCOVERY_WAIT_MS))
    ])
    return online.flatMap((info) => {
      const catalog = this.remote.get(info.id)
      return catalog && catalog.entries.length > 0 ? [catalog] : []
    })
  }

  /** The skill's instructions plus the files beside it, for the model to follow. */
  async load(name: string, machine?: HomeChatMachine): Promise<string> {
    if (machine && machine.info.id !== LOCAL_MACHINE_ID) {
      return this.loadRemote(name, machine)
    }
    try {
      return await this.loadLocal(name)
    } catch (error) {
      // list_skills also offers this computer's agent definitions and prompts.
      const found = machine ? await this.loadRemote(name, machine).catch(() => null) : null
      if (found === null) {
        throw error
      }
      return found
    }
  }

  invalidate(): void {
    this.cache = null
    this.remote.clear()
  }

  private async loadLocal(name: string): Promise<string> {
    const wanted = name.trim().toLowerCase()
    const named = (s: HomeChatSkill): boolean => s.name.toLowerCase() === wanted
    let skills = await this.list()
    let skill = skills.find(named)
    if (!skill) {
      // The list is a minute old at most; look again before saying a new skill does not exist.
      this.cache = null
      skills = await this.list()
      skill = skills.find(named)
    }
    if (!skill) {
      const known = skills.map((s) => s.name).join(', ')
      throw new Error(
        `No skill named "${name}" on this computer. Available: ${known || 'none'}. Skills on another machine need its machine argument.`
      )
    }
    const body = (await readFile(skill.skillFilePath, 'utf8')).slice(0, MAX_SKILL_CHARS)
    const files = (await listFiles(skill.directoryPath)).map((file) =>
      join(skill.directoryPath, file)
    )
    return skillText(skill.name, `${skill.source} (${skill.directoryPath})`, 'local', body, files)
  }

  private async loadRemote(name: string, machine: HomeChatMachine): Promise<string> {
    const wanted = name.trim().toLowerCase()
    const named = (e: HomeChatCatalogEntry): boolean =>
      e.kind !== 'instructions' && e.name.toLowerCase() === wanted
    const loadable = (entry: HomeChatCatalogEntry): boolean => entry.kind !== 'instructions'
    let catalog = await this.machineCatalog(machine)
    let entry = catalog.entries.find(named)
    if (!entry) {
      catalog = await this.machineCatalog(machine, undefined, true)
      entry = catalog.entries.find(named)
    }
    if (!entry) {
      const known = catalog.entries.filter(loadable).map((e) => e.name)
      throw new Error(
        `No skill named "${name}" on ${machine.info.label}. Available there: ${known.join(', ') || 'none'}`
      )
    }
    const { text } = await machine.readTextFile(entry.path, MAX_SKILL_CHARS)
    const directory = entry.path.replace(/[\\/][^\\/]+$/, '')
    const files = entry.kind === 'skill' ? await listSkillFolder(machine, directory) : []
    return skillText(
      entry.name,
      `${machine.info.label} (${entry.path})`,
      machine.info.id,
      text,
      files
    )
  }
}
