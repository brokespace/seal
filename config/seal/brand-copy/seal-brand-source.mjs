// Rewrites user-visible "Orca" copy inside JS/TS string literals, template text and JSX text.
// One implementation serves the build pass (Vite, esbuild, emitted CLI), the test runner and the
// in-place codemod, so a file reads the same whichever of them rewrote it.
import { parseSync } from 'oxc-parser'

import { rebrandCliCommands, rebrandCopy } from './seal-brand-copy.mjs'

export const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts'
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
  ['src/main/orcad/browser-providers/orcad-browser-provider.ts', 'install paths, edited by hand'],
  [
    'src/main/orcad/serve-startup/orcad-cli-launcher.integration.test.ts',
    'quotes a heading of the agent-facing orchestration skill guide'
  ]
])

const MODULE_SOURCE_PARENTS = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
  'TSExternalModuleReference',
  'TSImportType',
  'TSModuleDeclaration'
])
const MARKER_CONTENT = /[Dd]o not edit|>>>|<<<|\bBEGIN\b|\bEND\b/
const MARKER_NAME =
  /MARKER|SENTINEL|BLOCK_START|BLOCK_END|USER_AGENT|^TERM_PROGRAM$|^User-Agent$|^startMarker$|^endMarker$/
const TEST_FILE = /\.test\.|\/testing\/|\.test-fixture\.|tests\//
// Help names the installed `seal`; other CLI text keeps `orca`, which managed terminals always provide.
const CLI_COPY_FILE = /^src\/cli\/(?:specs|discovery)\//

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
      out.push({ node, parent })
    }
    return
  }
  for (const [childKey, child] of Object.entries(node)) {
    if (childKey !== 'parent' && child && typeof child === 'object') {
      collectCopyNodes(child, node, childKey, out)
    }
  }
}

/** Cheap pre-filter: only files naming the product or its command can change. */
export function mayContainBrandCopy(code) {
  return code.includes('Orca') || code.includes('orca')
}

/**
 * Rewrites the literals of one module with `rewrite(raw, node, parent)`; a literal it returns
 * unchanged (or undefined for) stays. Returns null when nothing changed, `{ error }` when
 * unparseable.
 */
function rewriteCopyLiterals(code, parsePath, rewrite) {
  const parsed = parseSync(parsePath, code)
  if (parsed.errors.length > 0) {
    return { error: parsed.errors[0]?.message ?? 'parse error', code, changes: [] }
  }
  const nodes = []
  collectCopyNodes(parsed.program, null, null, nodes)
  const changes = []
  let result = ''
  let cursor = 0
  for (const { node, parent } of nodes.sort((a, b) => a.node.start - b.node.start)) {
    const raw = code.slice(node.start, node.end)
    const next = rewrite(raw, node, parent)
    if (next === undefined || next === raw) {
      continue
    }
    result += code.slice(cursor, node.start) + next
    cursor = node.end
    changes.push([raw, next])
  }
  if (changes.length === 0) {
    return null
  }
  return { code: result + code.slice(cursor), changes }
}

/**
 * Rebrand one module. `relativePath` is the repo-relative source path (for emitted JS, the path of
 * the source it came from, with `parsePath` naming the emitted file so it parses as JavaScript);
 * `englishChanges` maps upstream English catalog values to Seal's.
 * Returns null when the file is skipped or unchanged, `{ error }` when it does not parse.
 */
export function rebrandSourceText(
  code,
  relativePath,
  { englishChanges = new Map(), parsePath = relativePath } = {}
) {
  if (SKIPPED_SOURCE_FILES.has(relativePath) || !mayContainBrandCopy(code)) {
    return null
  }
  const cliCopy = CLI_COPY_FILE.test(relativePath)
  // Tests assert copy with regexes; production regexes parse messages and are edited by hand.
  const testFile = TEST_FILE.test(relativePath)
  return rewriteCopyLiterals(code, parsePath, (raw, node) => {
    if (node.regex && !testFile) {
      return undefined
    }
    const catalogDefault = node.type === 'Literal' && englishChanges.has(node.value)
    const next = rebrandCopy(raw, { commands: catalogDefault })
    return cliCopy ? rebrandCliCommands(next) : next
  })
}

/** Upstream's default for `t(key, default)` when `node` is Seal's rebrand of it, as a literal. */
function upstreamCatalogDefault(raw, node, parent, upstreamEnglish) {
  if (
    node.type !== 'Literal' ||
    parent?.type !== 'CallExpression' ||
    parent.arguments[1] !== node ||
    parent.arguments[0]?.type !== 'Literal'
  ) {
    return undefined
  }
  const upstream = upstreamEnglish.get(parent.arguments[0].value)
  const quote = raw[0]
  if (
    typeof upstream !== 'string' ||
    upstream === node.value ||
    rebrandCopy(upstream, { commands: true }) !== node.value ||
    /[\\\n]/.test(upstream) ||
    upstream.includes(quote)
  ) {
    return undefined
  }
  return `${quote}${upstream}${quote}`
}

/**
 * The reverse, for a file edited in place: every literal that is the rebrand of one of upstream's
 * literals goes back to upstream's text, and so does a catalog default Seal wrote for one of
 * upstream's keys (`upstreamEnglish`: key to upstream's English value). Returns the module text,
 * unchanged when nothing matches.
 */
export function restoreUpstreamLiterals(code, upstreamCode, relativePath, options = {}) {
  const rebranded = rebrandSourceText(upstreamCode, relativePath, options)
  if (rebranded?.error) {
    return code
  }
  const upstreamByRebrand = new Map((rebranded?.changes ?? []).map(([raw, next]) => [next, raw]))
  const upstreamEnglish = options.upstreamEnglish ?? new Map()
  const restored = rewriteCopyLiterals(
    code,
    options.parsePath ?? relativePath,
    (raw, node, parent) =>
      upstreamByRebrand.get(raw) ?? upstreamCatalogDefault(raw, node, parent, upstreamEnglish)
  )
  return restored && !restored.error ? restored.code : code
}
