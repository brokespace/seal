import { summarizeSkillMarkdown } from '../../../shared/skill-metadata'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  scanMachineFiles,
  type MachineFileScanRecord,
  type MachineFileScanRequest
} from '../../machines/scan/machine-file-scan'
import { powerShellLiteral } from '../machines/home-chat-machine-scripts'
import type { HomeChatMachine } from '../machines/home-chat-machine-types'

/** What a machine offers the assistant beyond its tools: skills to load and instructions to read. */
export type HomeChatCatalogEntry = {
  kind: 'skill' | 'agent' | 'prompt' | 'instructions'
  name: string
  description: string
  path: string
  bytes: number
}

export type HomeChatMachineCatalog = {
  machineId: string
  machineLabel: string
  entries: HomeChatCatalogEntry[]
  at: number
}

const HEAD_BYTES = 1_200
const DISCOVERY_TIMEOUT_MS = 20_000

const HOME_SKILL_ROOTS = ['.claude/skills', '.codex/skills', '.cursor/skills', '.agents/skills']
const HOME_INSTRUCTIONS = ['.claude/CLAUDE.md', '.codex/AGENTS.md']
const PROJECT_SKILL_ROOTS = ['.claude/skills', '.agents/skills', '.cursor/skills']
const PROJECT_INSTRUCTIONS = ['CLAUDE.md', 'AGENTS.md']

/** What the catalog looks for; the scan itself is the one agent configuration uses. */
export function catalogScanRequest(projectPath?: string): MachineFileScanRequest {
  const project = projectPath?.replace(/[\\/]+$/, '')
  const home = (path: string): string => `~/${path}`
  const inProject = (path: string): string => `${project}/${path}`
  return {
    skillRoots: [
      ...HOME_SKILL_ROOTS.map(home),
      ...(project ? PROJECT_SKILL_ROOTS.map(inProject) : [])
    ].map((dir) => ({ tag: 'skill', dir })),
    trees: [
      { tag: 'agent', dir: home('.claude/agents'), extension: '.md', recursive: false },
      { tag: 'prompt', dir: home('.codex/prompts'), extension: '.md', recursive: false }
    ],
    files: [
      ...HOME_INSTRUCTIONS.map(home),
      ...(project ? PROJECT_INSTRUCTIONS.map(inProject) : [])
    ].map((path) => ({ tag: 'instructions', path })),
    headBytes: HEAD_BYTES
  }
}

function baseName(path: string): string {
  return path.replaceAll('\\', '/').split('/').at(-1) ?? path
}

function entryName(
  kind: HomeChatCatalogEntry['kind'],
  path: string,
  declared: string | null
): string {
  if (declared) {
    return declared
  }
  const parts = path.replaceAll('\\', '/').split('/')
  return kind === 'skill' ? (parts.at(-2) ?? path) : baseName(path).replace(/\.md$/i, '')
}

function catalogEntries(records: readonly MachineFileScanRecord[]): HomeChatCatalogEntry[] {
  return records.flatMap(({ tag: kind, path, bytes, head }): HomeChatCatalogEntry[] => {
    if (kind !== 'skill' && kind !== 'agent' && kind !== 'prompt' && kind !== 'instructions') {
      return []
    }
    const summary = kind === 'instructions' ? null : summarizeSkillMarkdown(head)
    return [
      {
        kind,
        path,
        bytes,
        name: entryName(kind, path, summary?.name ?? null),
        description: summary?.description ?? ''
      }
    ]
  })
}

/** One round trip: every skill, agent, prompt and instruction file the machine has, with front matter. */
export async function discoverMachineCatalog(
  machine: HomeChatMachine,
  projectPath?: string
): Promise<HomeChatMachineCatalog> {
  const scan = await scanMachineFiles(
    machine,
    catalogScanRequest(projectPath),
    DISCOVERY_TIMEOUT_MS
  )
  return {
    machineId: machine.info.id,
    machineLabel: machine.info.label,
    entries: catalogEntries(scan.records),
    at: Date.now()
  }
}

const MAX_LISTED_FILES = 80

/** The files beside a SKILL.md, as absolute paths on that machine. */
export async function listSkillFolder(
  machine: HomeChatMachine,
  directory: string
): Promise<string[]> {
  const script =
    machine.dialect === 'powershell'
      ? `Get-ChildItem -LiteralPath ${powerShellLiteral(directory)} -Recurse -File | Select-Object -First ${MAX_LISTED_FILES} -ExpandProperty FullName`
      : // Relative to the folder, so a dot-folder above it (~/.claude) does not hide everything.
        `cd ${quotePosixShell(directory)} && find . -type f ! -name SKILL.md ! -path '*/.*' 2>/dev/null | head -${MAX_LISTED_FILES}`
  const result = await machine.exec(script, { timeoutMs: DISCOVERY_TIMEOUT_MS }).catch(() => null)
  return (result?.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/(^|[\\/])SKILL\.md$/.test(line))
    .map((line) => (line.startsWith('./') ? `${directory}/${line.slice(2)}` : line))
}
