import { summarizeSkillMarkdown } from '../../../shared/skill-metadata'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { posixPathWord } from '../machines/home-chat-machine-paths'
import { powerShellLiteral } from '../machines/home-chat-machine-scripts'
import type { HomeChatMachine, HomeChatShellDialect } from '../machines/home-chat-machine-types'

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

const RECORD = '\u001e'
const FIELD = '\u001f'
const HEAD_BYTES = 1_200
const DISCOVERY_TIMEOUT_MS = 20_000

const HOME_SKILL_ROOTS = ['.claude/skills', '.codex/skills', '.cursor/skills', '.agents/skills']
const HOME_INSTRUCTIONS = ['.claude/CLAUDE.md', '.codex/AGENTS.md']
const PROJECT_SKILL_ROOTS = ['.claude/skills', '.agents/skills', '.cursor/skills']
const PROJECT_INSTRUCTIONS = ['CLAUDE.md', 'AGENTS.md']

function posixScript(projectPath: string | undefined): string {
  const home = (path: string): string => `"$HOME/${path}"`
  const project = (path: string): string => posixPathWord(`${projectPath}/${path}`)
  const skillRoots = [
    ...HOME_SKILL_ROOTS.map(home),
    ...(projectPath ? PROJECT_SKILL_ROOTS.map(project) : [])
  ]
  const instructions = [
    ...HOME_INSTRUCTIONS.map(home),
    ...(projectPath ? PROJECT_INSTRUCTIONS.map(project) : [])
  ]
  return [
    `emit() { [ -f "$2" ] || return 0; printf '\\036%s\\037%s\\037%s\\037' "$1" "$2" "$(wc -c < "$2" | tr -d ' ')"; head -c ${HEAD_BYTES} "$2"; }`,
    `for root in ${skillRoots.join(' ')}; do [ -d "$root" ] || continue; for f in "$root"/*/SKILL.md; do emit skill "$f"; done; done`,
    'for f in "$HOME/.claude/agents"/*.md; do emit agent "$f"; done',
    'for f in "$HOME/.codex/prompts"/*.md; do emit prompt "$f"; done',
    ...instructions.map((path) => `emit instructions ${path}`),
    'exit 0'
  ].join('\n')
}

function powerShellScript(projectPath: string | undefined): string {
  const home = (path: string): string =>
    `(Join-Path $h ${powerShellLiteral(path.replaceAll('/', '\\'))})`
  const project = (path: string): string =>
    powerShellLiteral(`${projectPath}\\${path.replaceAll('/', '\\')}`)
  const skillRoots = [
    ...HOME_SKILL_ROOTS.map(home),
    ...(projectPath ? PROJECT_SKILL_ROOTS.map(project) : [])
  ]
  const instructions = [
    ...HOME_INSTRUCTIONS.map(home),
    ...(projectPath ? PROJECT_INSTRUCTIONS.map(project) : [])
  ]
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$h = $env:USERPROFILE',
    'function Emit($kind, $path) {',
    '  if (Test-Path -LiteralPath $path -PathType Leaf) {',
    '    $bytes = [IO.File]::ReadAllBytes($path)',
    `    $head = [Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min($bytes.Length, ${HEAD_BYTES}))`,
    '    [Console]::Out.Write([string][char]30 + $kind + [char]31 + $path + [char]31 + $bytes.Length + [char]31 + $head)',
    '  }',
    '}',
    `foreach ($root in @(${skillRoots.join(', ')})) { if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root -Directory | ForEach-Object { Emit 'skill' (Join-Path $_.FullName 'SKILL.md') } } }`,
    `Get-ChildItem -Path ${home('.claude/agents')} -Filter *.md | ForEach-Object { Emit 'agent' $_.FullName }`,
    `Get-ChildItem -Path ${home('.codex/prompts')} -Filter *.md | ForEach-Object { Emit 'prompt' $_.FullName }`,
    ...instructions.map((path) => `Emit 'instructions' ${path}`)
  ].join('\n')
}

export function catalogDiscoveryScript(
  dialect: HomeChatShellDialect,
  projectPath?: string
): string {
  const project = projectPath?.replace(/[\\/]+$/, '')
  return dialect === 'powershell' ? powerShellScript(project) : posixScript(project)
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

export function parseCatalogOutput(stdout: string): HomeChatCatalogEntry[] {
  return stdout
    .split(RECORD)
    .slice(1)
    .flatMap((record): HomeChatCatalogEntry[] => {
      const [kind, path, bytes, ...head] = record.split(FIELD)
      if (
        !path ||
        (kind !== 'skill' && kind !== 'agent' && kind !== 'prompt' && kind !== 'instructions')
      ) {
        return []
      }
      const summary = kind === 'instructions' ? null : summarizeSkillMarkdown(head.join(FIELD))
      return [
        {
          kind,
          path,
          bytes: Number.parseInt(bytes ?? '', 10) || 0,
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
  const result = await machine.exec(catalogDiscoveryScript(machine.dialect, projectPath), {
    timeoutMs: DISCOVERY_TIMEOUT_MS
  })
  if (result.exitCode !== 0 && !result.stdout.includes(RECORD)) {
    throw new Error(result.stderr.trim() || `Could not look for skills on ${machine.info.label}`)
  }
  return {
    machineId: machine.info.id,
    machineLabel: machine.info.label,
    entries: parseCatalogOutput(result.stdout),
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
