// Rewrites user-visible "Orca" copy to "Seal" in the files no build produces: tests that run
// outside Vitest, build scripts, docs, the docs site and the native mobile catalogs. Bundled source
// and the app catalogs are rebranded at build time instead (seal-brand-vite-plugin.mjs) and stay
// upstream's on disk. Rerun after merging upstream (docs/upstream-sync.md); `--dry-run --list`
// names every literal it would change, and the rebrand check fails while it would change any.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import process from 'node:process'

import { readEnglishBrandChanges, rebrandCatalog } from './seal-brand-catalog.mjs'
import { rebrandCommands, rebrandCopy } from './seal-brand-copy.mjs'
import { CODE_EXTENSIONS, rebrandSourceText } from './seal-brand-source.mjs'
import {
  IN_PLACE_CATALOG_DIRS,
  IN_PLACE_DOC_ROOTS,
  IN_PLACE_JSON_FILES,
  IN_PLACE_SOURCE_FILES,
  IN_PLACE_SOURCE_ROOTS
} from './seal-brand-surfaces.mjs'

const DOC_EXTENSIONS = new Set(['.md', '.mdx'])
const SKIPPED_DIRS = new Set(['node_modules', 'out', 'dist', 'locales', '.cross-version-checkouts'])
// Upstream's offline translation tooling (keyed by upstream English), dev-only bundle names and
// generators of the agent-facing skill files.
const SKIPPED_PATHS = [
  'config/scripts/locale-catalog/',
  'config/scripts/development/',
  'config/scripts/skills/'
]
// Upstream-sync instructions and side-by-side guides name an installed Orca on purpose.
const SKIPPED_DOCS = new Set([
  'docs/upstream-sync.md',
  'docs/TESTING-seal-all.md',
  'docs/live-sessions-input.md',
  'docs/live-sessions-shell-integration.md'
])

function walkFiles(root, dir, extensions, files = []) {
  let entries
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (
        !SKIPPED_DIRS.has(entry.name) &&
        !SKIPPED_PATHS.some((prefix) => `${path}/`.startsWith(prefix))
      ) {
        walkFiles(root, path, extensions, files)
      }
    } else if (extensions.has(extname(entry.name))) {
      files.push(path)
    }
  }
  return files
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

/** Rebrand a Markdown document: prose everywhere, only typed commands inside code. */
export function rebrandDocText(text) {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence
        return line
      }
      return inFence ? rebrandCommands(line) : rebrandProseLine(line)
    })
    .join('\n')
}

const JSON_STRING = /("(?:[^"\\\n]|\\.)*")(\s*:)?/g

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * The rebrand of one in-place file, or null when the brand pass does not own it. Shared with the
 * merge-conflict resolver, which runs it over upstream's side of a conflict. `commandKeys` carries
 * the keys of a catalog directory whose English names the typed command; English goes first.
 */
export function rebrandInPlaceText(path, text, englishChanges, commandKeys = new Set()) {
  if (SKIPPED_PATHS.some((prefix) => path.startsWith(prefix))) {
    return null
  }
  const extension = extname(path)
  if (
    CODE_EXTENSIONS.has(extension) &&
    (IN_PLACE_SOURCE_FILES.includes(path) ||
      IN_PLACE_SOURCE_ROOTS.some((sourceRoot) => path.startsWith(`${sourceRoot}/`)))
  ) {
    const result = rebrandSourceText(text, path, { englishChanges })
    return result?.error ? null : (result?.code ?? text)
  }
  if (
    DOC_EXTENSIONS.has(extension) &&
    !SKIPPED_DOCS.has(path) &&
    IN_PLACE_DOC_ROOTS.some((docRoot) => path.startsWith(`${docRoot}/`))
  ) {
    return rebrandDocText(text)
  }
  if (extension !== '.json') {
    return null
  }
  if (IN_PLACE_CATALOG_DIRS.some((dir) => path.startsWith(`${dir}/`))) {
    const locale = basename(path, '.json')
    return formatJson(rebrandCatalog(JSON.parse(text), { locale, commandKeys }).catalog)
  }
  if (IN_PLACE_JSON_FILES.includes(path)) {
    // Hand-formatted, so only the string values change; keys are followed by a colon.
    return text.replace(JSON_STRING, (token, literal, keyColon) =>
      keyColon ? token : JSON.stringify(rebrandCopy(JSON.parse(literal)))
    )
  }
  return null
}

function nativeCatalogFiles(root, dir) {
  // English first: it decides which keys name the typed command.
  return readdirSync(join(root, dir))
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => Number(b === 'en.json') - Number(a === 'en.json'))
    .map((name) => `${dir}/${name}`)
}

/** Every in-place file the brand pass would change, as `{ path, before, after }`. */
export function collectInPlaceBrandChanges(root) {
  const englishChanges = readEnglishBrandChanges(root)
  const changes = []
  const rebrandFiles = (files, commandKeys) => {
    for (const path of files) {
      const before = readFileSync(join(root, path), 'utf8')
      const after = rebrandInPlaceText(path, before, englishChanges, commandKeys)
      if (after !== null && after !== before) {
        changes.push({ path, before, after })
      }
    }
  }
  rebrandFiles([
    ...IN_PLACE_SOURCE_ROOTS.flatMap((dir) => walkFiles(root, dir, CODE_EXTENSIONS)),
    ...IN_PLACE_SOURCE_FILES,
    ...IN_PLACE_DOC_ROOTS.flatMap((dir) => walkFiles(root, dir, DOC_EXTENSIONS)),
    ...IN_PLACE_JSON_FILES
  ])
  for (const dir of IN_PLACE_CATALOG_DIRS) {
    rebrandFiles(nativeCatalogFiles(root, dir), new Set())
  }
  return changes
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const root = process.cwd()
  const changes = collectInPlaceBrandChanges(root)
  if (!args.includes('--dry-run')) {
    for (const { path, after } of changes) {
      writeFileSync(join(root, path), after)
    }
  }
  if (args.includes('--list')) {
    console.log(changes.map(({ path }) => path).join('\n'))
  }
  console.log(`${changes.length} file(s) ${args.includes('--dry-run') ? 'would be ' : ''}rebranded`)
}
