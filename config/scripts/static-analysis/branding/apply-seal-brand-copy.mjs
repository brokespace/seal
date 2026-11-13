// Rewrites user-visible "Orca" copy to "Seal" in locale catalogs, source string literals and docs.
// Rerun after merging upstream Orca (docs/UPSTREAM.md); `--dry-run` lists every literal it would change.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import process from 'node:process'
import { parseSync } from 'oxc-parser'

import {
  rebrandCliCommands,
  rebrandCommands,
  rebrandCopy,
  rebrandLocalizedCommands
} from './seal-brand-copy.mjs'

const root = process.cwd()
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

export const LOCALE_CATALOG_DIRS = [
  { dir: 'src/renderer/src/i18n/locales', surface: 'desktop' },
  { dir: 'mobile/src/i18n/locales', surface: 'mobile' },
  { dir: 'mobile/locales', surface: 'mobile-native' }
]
export const RUNTIME_REQUIRED_CATALOGS = [
  { path: 'src/renderer/src/i18n/en-runtime-required.json', surface: 'desktop' },
  { path: 'mobile/src/i18n/en-runtime-required.json', surface: 'mobile' }
]
const SOURCE_ROOTS = [
  'src',
  'mobile/app',
  'mobile/src',
  'mobile/web-entry',
  'tests',
  'config/scripts',
  'docs/site/src'
]
const DOC_ROOTS = ['docs']
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const DOC_EXTENSIONS = new Set(['.md', '.mdx'])
const SKIPPED_DIRS = new Set(['node_modules', 'out', 'dist', 'locales', '.cross-version-checkouts'])
// Upstream's offline translation tooling (keyed by upstream English), dev-only bundle names,
// generators of the agent-facing skill files, and this codemod.
const SKIPPED_PATHS = [
  'config/scripts/locale-catalog/',
  'config/scripts/development/',
  'config/scripts/skills/',
  'config/scripts/static-analysis/branding/'
]
// Upstream-sync instructions and side-by-side guides name an installed Orca on purpose.
const SKIPPED_DOCS = new Set([
  'docs/UPSTREAM.md',
  'docs/TESTING-seal-all.md',
  'docs/live-sessions-input.md',
  'docs/live-sessions-shell-integration.md'
])

function walkFiles(dir, extensions, files = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const path = `${relative(root, full)}/`
      if (
        !SKIPPED_DIRS.has(entry.name) &&
        !SKIPPED_PATHS.some((prefix) => path.startsWith(prefix))
      ) {
        walkFiles(full, extensions, files)
      }
    } else if (extensions.has(extname(entry.name))) {
      files.push(full)
    }
  }
  return files
}

function rebrandTree(value, context, path = '') {
  if (typeof value === 'string') {
    let next = rebrandCopy(value, { locale: context.locale, commands: true })
    if (context.locale === 'en' && /\borca\b/.test(value) && !/\borca\b/.test(next)) {
      context.commandKeys.add(path)
    } else if (context.locale !== 'en' && context.commandKeys.has(path)) {
      next = rebrandLocalizedCommands(next)
    }
    if (next !== value) {
      context.changes.push([value, next])
    }
    return next
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => rebrandTree(item, context, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        rebrandTree(child, context, `${path}.${key}`)
      ])
    )
  }
  return value
}

function rebrandCatalogFile(path, locale, englishChanges, commandKeys) {
  const before = readFileSync(path, 'utf8')
  const context = { locale, commandKeys, changes: [] }
  const after = `${JSON.stringify(rebrandTree(JSON.parse(before), context), null, 2)}\n`
  if (locale === 'en') {
    for (const [from, to] of context.changes) {
      englishChanges.set(from, to)
    }
  }
  if (after !== before && !dryRun) {
    writeFileSync(path, after)
  }
  return context.changes.length
}

function rebrandCatalogs() {
  const englishChanges = new Map()
  let total = 0
  for (const { dir } of LOCALE_CATALOG_DIRS) {
    const commandKeys = new Set()
    const names = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort((a, b) => Number(b === 'en.json') - Number(a === 'en.json'))
    for (const name of names) {
      total += rebrandCatalogFile(
        join(dir, name),
        basename(name, '.json'),
        englishChanges,
        commandKeys
      )
    }
  }
  for (const { path } of RUNTIME_REQUIRED_CATALOGS) {
    try {
      statSync(path)
    } catch {
      continue
    }
    total += rebrandCatalogFile(path, 'en', englishChanges, new Set())
  }
  console.log(`catalogs: ${total} value(s) rebranded`)
  return englishChanges
}

// Catalogs may already be rewritten, so source defaults are matched against English at a git ref.
function englishChangesAt(ref) {
  const englishChanges = new Map()
  const englishPaths = [
    ...LOCALE_CATALOG_DIRS.map(({ dir }) => `${dir}/en.json`),
    ...RUNTIME_REQUIRED_CATALOGS.map(({ path }) => path)
  ]
  for (const path of englishPaths) {
    let text
    try {
      text = execFileSync('git', ['show', `${ref}:${path}`], {
        encoding: 'utf8',
        maxBuffer: 1 << 28
      })
    } catch {
      continue
    }
    const context = { locale: 'en', commandKeys: new Set(), changes: [] }
    rebrandTree(JSON.parse(text), context)
    for (const [from, to] of context.changes) {
      englishChanges.set(from, to)
    }
  }
  return englishChanges
}

const MODULE_SOURCE_PARENTS = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
  'TSExternalModuleReference',
  'TSImportType',
  'TSModuleDeclaration'
])

// Each keeps "Orca" because another program or an earlier install reads the exact value.
export const SKIPPED_SOURCE_FILES = new Map([
  [
    'src/cli/skills/bundled-skill-guides.ts',
    'generated from skill-guides/ (agent-facing CLI contract)'
  ],
  ['src/main/skills/bundled-skill-install/bundled-skill-sources.ts', 'generated from skills/'],
  ['src/shared/marine-creature-names-primary.ts', 'the orca whale in random worktree names'],
  [
    'src/main/claude/theme-sync/claude-code-theme.ts',
    'theme name already installed in Claude Code'
  ],
  [
    'src/main/claude/theme-sync/claude-code-theme-sync.ts',
    'theme name already installed in Claude Code'
  ],
  [
    'src/main/claude/theme-sync/claude-code-theme-sync.test.ts',
    'theme name already installed in Claude Code'
  ],
  [
    'config/scripts/desktop-distribution/macos/macos-executable-uuid.test.mjs',
    'UUIDs hashed from the fixture name'
  ],
  ['src/packages/process-host/src/wsl-distro-allowlist.test.ts', 'distro names, not copy'],
  ['src/shared/project-host-setup-projection.test.ts', 'upstream GitHub repo identity'],
  [
    'src/main/runtime/agent-session/naming/structured-agent-session-provider-naming-shutdown.test.ts',
    'Codex app-server clientInfo identity'
  ],
  [
    'src/main/codex/app-server/codex-app-server-handshake.ts',
    'Codex app-server clientInfo identity'
  ],
  ['src/main/codex/app-server/codex-app-server-session.ts', 'Codex app-server clientInfo identity'],
  [
    'src/main/text-generation/models/codex-model-list-discovery.ts',
    'Codex app-server clientInfo identity'
  ],
  ['src/main/jira/authenticated-request.ts', 'Jira API User-Agent'],
  ['src/main/jira/cloud-gateway.ts', 'Jira API User-Agent'],
  [
    'src/renderer/src/components/plugins/list/plugin-display-name.ts',
    'casing for plugin ids such as orca-*'
  ],
  [
    'src/main/orcad/host-runtime/orcad-app-paths.ts',
    'headless server data directory (upstream-compatible)'
  ],
  ['src/main/orcad/browser-providers/orcad-browser-provider.ts', 'install paths, edited by hand']
])
const MARKER_CONTENT = /[Dd]o not edit|>>>|<<<|\bBEGIN\b|\bEND\b/
const MARKER_NAME =
  /MARKER|SENTINEL|BLOCK_START|BLOCK_END|USER_AGENT|^TERM_PROGRAM$|^User-Agent$|^startMarker$|^endMarker$/

function bindingName(parent, key) {
  if (parent.type === 'VariableDeclarator' && key === 'init') {
    return parent.id?.name
  }
  if (parent.type === 'Property' && key === 'value') {
    return parent.key?.name ?? parent.key?.value
  }
  return undefined
}

function isSkippedLiteral(node, parent, key) {
  if (!parent) {
    return false
  }
  const content = typeof node.value === 'string' ? node.value : node.value?.raw
  if (typeof content === 'string' && MARKER_CONTENT.test(content)) {
    return true
  }
  const name = bindingName(parent, key)
  if (typeof name === 'string' && MARKER_NAME.test(name)) {
    return true
  }
  if (MODULE_SOURCE_PARENTS.has(parent.type) && key !== 'body') {
    return true
  }
  if (parent.type === 'CallExpression' && parent.callee?.name === 'require') {
    return true
  }
  // Object keys and enum members are lookups, not copy.
  if ((parent.type === 'Property' || parent.type === 'PropertyDefinition') && key === 'key') {
    return !parent.computed
  }
  return parent.type === 'TSEnumMember' && key === 'id'
}

function collectCopyNodes(node, parent, key, out) {
  if (!node || typeof node !== 'object') {
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectCopyNodes(child, parent, key, out)
    }
    return
  }
  if (
    (node.type === 'Literal' && (typeof node.value === 'string' || node.regex)) ||
    node.type === 'TemplateElement' ||
    node.type === 'JSXText'
  ) {
    if (!isSkippedLiteral(node, parent, key)) {
      out.push(node)
    }
    return
  }
  for (const [childKey, child] of Object.entries(node)) {
    if (childKey !== 'parent' && child && typeof child === 'object') {
      collectCopyNodes(child, node, childKey, out)
    }
  }
}

function rebrandSourceFile(path, englishChanges, listing) {
  if (SKIPPED_SOURCE_FILES.has(relative(root, path))) {
    return 0
  }
  const before = readFileSync(path, 'utf8')
  if (!before.includes('Orca') && !before.includes('orca')) {
    return 0
  }
  const parsed = parseSync(path, before)
  if (parsed.errors.length > 0) {
    console.warn(`skip (parse error): ${relative(root, path)}`)
    return 0
  }
  const nodes = []
  collectCopyNodes(parsed.program, null, null, nodes)
  const relativePath = relative(root, path)
  // Help names the installed `seal`; other CLI text keeps `orca`, which managed terminals always provide.
  const cliCopy = /^src\/cli\/(?:specs|discovery)\//.test(relativePath)
  let after = ''
  let cursor = 0
  let count = 0
  // Tests assert copy with regexes; production regexes parse messages and are edited by hand.
  const testFile = /\.test\.|\/testing\/|\.test-fixture\.|tests\//.test(relativePath)
  for (const node of nodes.sort((a, b) => a.start - b.start)) {
    if (node.regex && !testFile) {
      continue
    }
    const raw = before.slice(node.start, node.end)
    const catalogDefault = node.type === 'Literal' && englishChanges.has(node.value)
    let next = rebrandCopy(raw, { commands: catalogDefault })
    if (cliCopy) {
      next = rebrandCliCommands(next)
    }
    if (next === raw) {
      continue
    }
    after += before.slice(cursor, node.start) + next
    cursor = node.end
    count += 1
    listing.push(`${relative(root, path)}: ${raw.trim().slice(0, 160)}`)
  }
  after += before.slice(cursor)
  if (count > 0 && !dryRun) {
    writeFileSync(path, after)
  }
  return count
}

function rebrandSources(englishChanges, listing) {
  let total = 0
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of walkFiles(sourceRoot, CODE_EXTENSIONS)) {
      total += rebrandSourceFile(file, englishChanges, listing)
    }
  }
  console.log(`sources: ${total} literal(s) rebranded`)
}

const FENCE = /^(\s*)(```|~~~)/
// Inline code, link targets and HTML attributes are paths and URLs, not prose.
const PROTECTED_SPAN = /(`[^`\n]*`|\]\([^)\n]*\)|(?:href|src)="[^"]*")/g

function rebrandProseLine(line) {
  return line
    .split(PROTECTED_SPAN)
    .map((part, index) => {
      if (index % 2 === 0) {
        return rebrandCopy(part, { commands: true })
      }
      return part.startsWith('`') ? rebrandCommands(part) : part
    })
    .join('')
}

function rebrandDocFile(path, listing) {
  const before = readFileSync(path, 'utf8')
  let inFence = false
  let count = 0
  const after = before
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence
        return line
      }
      const next = inFence ? rebrandCommands(line) : rebrandProseLine(line)
      if (next !== line) {
        count += 1
      }
      return next
    })
    .join('\n')
  if (count > 0) {
    listing.push(`${relative(root, path)}: ${count} line(s)`)
    if (!dryRun) {
      writeFileSync(path, after)
    }
  }
  return count
}

function rebrandDocs(listing) {
  let total = 0
  for (const docRoot of DOC_ROOTS) {
    for (const file of walkFiles(docRoot, DOC_EXTENSIONS)) {
      if (!SKIPPED_DOCS.has(relative(root, file))) {
        total += rebrandDocFile(file, listing)
      }
    }
  }
  console.log(`docs: ${total} line(s) rebranded`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const listing = []
  const englishChanges = rebrandCatalogs()
  const baseRef = args.find((arg) => arg.startsWith('--base='))?.slice('--base='.length) ?? 'HEAD'
  for (const [from, to] of englishChangesAt(baseRef)) {
    englishChanges.set(from, to)
  }
  if (!args.includes('--catalogs-only')) {
    rebrandSources(englishChanges, listing)
    rebrandDocs(listing)
  }
  if (args.includes('--list')) {
    console.log(listing.join('\n'))
  }
}
