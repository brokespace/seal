// `pnpm seal:rebrand-check`: fails when upstream's product name reaches a Seal user. It reads what
// ships rather than what is on disk, since bundled source keeps upstream's text until the build:
//   - the locale catalogs as built (upstream's, rebranded, with Seal's overlay)
//   - bundled source as the brand pass leaves it (menus, window titles, notifications, CLI help)
//   - the built app under out/, when it exists, to prove every bundler applied the pass
//   - installer metadata, native prompts, launchers and the docs site
//   - the files rebranded in place, which must have nothing left for the codemod to change
//   - the hook points that put the brand pass into each bundler, and the identity constants
// Attribution, internal ids and the `orca` command are allowed (seal-rebrand-allowlist.mjs).
// `--built` makes a missing out/ a failure, for CI after a build. See docs/upstream-sync.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import process from 'node:process'
import { parseSync } from 'oxc-parser'

import { collectInPlaceBrandChanges } from '../brand-copy/apply-seal-brand-copy.mjs'
import {
  LOCALE_SURFACES,
  createSurfaceCatalogBuilder,
  readEnglishBrandChanges
} from '../brand-copy/seal-brand-catalog.mjs'
import { findBrandMentions } from '../brand-copy/seal-brand-copy.mjs'
import { CODE_EXTENSIONS, rebrandSourceText } from '../brand-copy/seal-brand-source.mjs'
import { BUILD_PASS_SOURCE_ROOTS } from '../brand-copy/seal-brand-surfaces.mjs'
import {
  BRAND_PASS_HOOKS,
  BUILT_COPY_ALLOWLIST,
  BUILT_OUTPUT_DIRS,
  BUNDLED_SOURCE_ALLOWLIST,
  DOCS_SITE_CONTENT,
  IDENTITY_CONSTANTS,
  TEXT_LINE_ALLOWLIST,
  USER_VISIBLE_TEXT_FILES
} from './seal-rebrand-allowlist.mjs'

const root = process.cwd()
const requireBuilt = process.argv.includes('--built')
const require = createRequire(import.meta.url)
const branding = require('../seal-branding.cjs')

const failures = []
const notes = []

function fail(surface, where, text) {
  failures.push(`[${surface}] ${where}: ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}`)
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function* stringLeaves(value, path = '') {
  if (typeof value === 'string') {
    yield [path, value]
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      yield* stringLeaves(child, path ? `${path}.${key}` : key)
    }
  }
}

function walk(dir, extensions, files = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        walk(path, extensions, files)
      }
    } else if (extensions.has(extname(entry.name))) {
      files.push(path)
    }
  }
  return files
}

function checkShippedCatalogs() {
  for (const surface of LOCALE_SURFACES) {
    const builder = createSurfaceCatalogBuilder(root, surface)
    const catalogs = readdirSync(join(root, surface.dir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => [
        `${surface.dir}/${name}`,
        builder.buildLocaleCatalog(
          JSON.parse(read(`${surface.dir}/${name}`)),
          name.slice(0, -'.json'.length)
        )
      ])
    catalogs.push([
      surface.runtimeRequiredPath,
      builder.buildRuntimeRequiredCatalog(JSON.parse(read(surface.runtimeRequiredPath)))
    ])
    for (const [path, catalog] of catalogs) {
      for (const [key, value] of stringLeaves(catalog)) {
        if (findBrandMentions(value).length > 0) {
          fail('catalog', `${path} ${key}`, value)
        }
      }
      // Upstream never writes Seal's name, so finding it means a branch edited upstream's file.
      if (new RegExp(`\\b${branding.productName}\\b`).test(read(path))) {
        fail(
          'catalog',
          path,
          `holds ${branding.productName} copy; move it to the overlay with \`pnpm seal:sync:restore\``
        )
      }
    }
  }
}

function checkInPlaceFiles() {
  for (const { path } of collectInPlaceBrandChanges(root)) {
    fail('in-place', path, 'has copy the codemod would rebrand; run `pnpm seal:rebrand-apply`')
  }
}

function checkInstallerMetadata() {
  const builderConfig = require(join(root, 'config/electron-builder.config.cjs'))
  for (const [key, value] of stringLeaves(builderConfig)) {
    if (findBrandMentions(value).length > 0) {
      fail('installer', `electron-builder ${key}`, value)
    }
  }
  const manifests = [
    ['package.json', ['productName', 'description', 'homepage', 'author']],
    ['mobile/app.json', null]
  ]
  for (const [path, fields] of manifests) {
    const manifest = JSON.parse(read(path))
    const subject = fields
      ? Object.fromEntries(fields.map((key) => [key, manifest[key]]))
      : manifest
    for (const [key, value] of stringLeaves(subject)) {
      if (findBrandMentions(value).length > 0) {
        fail('installer', [path, key].join(' '), value)
      }
    }
  }
}

const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*|<!--|REM\b|::|;)/

function checkUserVisibleTextFiles() {
  const files = [
    ...USER_VISIBLE_TEXT_FILES,
    ...walk(DOCS_SITE_CONTENT, new Set(['.md', '.mdx', '.json']))
  ]
  for (const path of files) {
    if (!existsSync(join(root, path))) {
      fail('text', path, 'listed in seal-rebrand-allowlist.mjs but missing')
      continue
    }
    read(path)
      .split('\n')
      .forEach((line, index) => {
        if (
          !COMMENT_LINE.test(line) &&
          !TEXT_LINE_ALLOWLIST.some((pattern) => pattern.test(line)) &&
          findBrandMentions(line).length > 0
        ) {
          fail('text', `${path}:${index + 1}`, line)
        }
      })
  }
}

function checkHooksAndIdentity() {
  for (const [path, marker] of BRAND_PASS_HOOKS) {
    if (!read(path).includes(marker)) {
      fail('hook', path, `no longer applies the brand pass (expected \`${marker}\`)`)
    }
  }
  for (const [path, expected] of IDENTITY_CONSTANTS(branding)) {
    if (!read(path).includes(expected)) {
      fail('identity', path, `does not carry \`${expected}\` from config/seal/seal-branding.cjs`)
    }
  }
}

/** Text of every string literal, template chunk and JSX text under `node`. */
function collectStrings(node, out) {
  if (!node || typeof node !== 'object') {
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectStrings(child, out)
    }
    return
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    out.push(node.value)
    return
  }
  if (node.type === 'TemplateElement') {
    out.push(node.value?.cooked ?? node.value?.raw ?? '')
    return
  }
  if (node.type === 'JSXText') {
    out.push(node.value)
    return
  }
  for (const key in node) {
    const child = node[key]
    if (child && typeof child === 'object') {
      collectStrings(child, out)
    }
  }
}

function brandedStrings(path, code) {
  const parsed = parseSync(path, code)
  if (parsed.errors.length > 0) {
    fail('parse', path, parsed.errors[0].message)
    return []
  }
  const strings = []
  collectStrings(parsed.program, strings)
  return [...new Set(strings)].filter((text) => findBrandMentions(text).length > 0)
}

function builtStrings(path, code) {
  if (path.endsWith('.html')) {
    return code.split('\n').filter((line) => findBrandMentions(line).length > 0)
  }
  if (path.endsWith('.json')) {
    return stringLeaves(JSON.parse(code))
      .map(([, value]) => value)
      .filter((text) => findBrandMentions(text).length > 0)
  }
  return brandedStrings(path, code)
}

const NOT_SHIPPED = /\.test\.|\/testing\/|\.test-fixture\.|__fixtures__|\.fixture\.|test-support/

/** Upstream names the brand pass leaves in bundled source; returns the allowlisted ones. */
function checkBundledSource() {
  const englishChanges = readEnglishBrandChanges(root)
  const allowed = []
  for (const sourceRoot of BUILD_PASS_SOURCE_ROOTS) {
    for (const path of walk(sourceRoot, CODE_EXTENSIONS)) {
      const code = read(path)
      if (NOT_SHIPPED.test(path) || !code.includes(branding.upstreamProductName)) {
        continue
      }
      const rebranded = rebrandSourceText(code, path, { englishChanges })
      if (rebranded?.error) {
        fail('source', path, `the brand pass cannot parse it: ${rebranded.error}`)
        continue
      }
      for (const text of brandedStrings(path, rebranded?.code ?? code)) {
        if (BUNDLED_SOURCE_ALLOWLIST.has(path)) {
          allowed.push(text)
        } else {
          fail('source', path, text)
        }
      }
    }
  }
  return allowed
}

function normalizeCopy(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/** Minifiers join and split literals, so a built string is matched against the allowed ones loosely. */
function checkBuiltOutput(allowedSourceStrings) {
  const dirs = BUILT_OUTPUT_DIRS.filter((dir) => existsSync(join(root, dir)))
  if (dirs.length === 0) {
    if (requireBuilt) {
      fail(
        'built',
        BUILT_OUTPUT_DIRS.join(', '),
        'not built; run `pnpm build:desktop:assets` first'
      )
    } else {
      notes.push('out/ is not built, so the built app was not scanned (CI runs with --built).')
    }
    return
  }
  const allowed = [...new Set(allowedSourceStrings.map(normalizeCopy))]
  const isAllowed = (text) =>
    BUILT_COPY_ALLOWLIST.some((pattern) => pattern.test(text)) ||
    allowed.some((known) => known.includes(text) || (known.length >= 20 && text.includes(known)))
  let scanned = 0
  for (const dir of dirs) {
    for (const path of walk(dir, new Set(['.js', '.mjs', '.cjs', '.html', '.json']))) {
      const code = read(path)
      if (!code.includes(branding.upstreamProductName)) {
        continue
      }
      scanned += 1
      for (const text of builtStrings(path, code)) {
        if (!isAllowed(normalizeCopy(text))) {
          fail('built', path, text)
        }
      }
    }
  }
  notes.push(`scanned ${scanned} built file(s) that mention ${branding.upstreamProductName}.`)
}

checkShippedCatalogs()
checkInPlaceFiles()
checkInstallerMetadata()
checkUserVisibleTextFiles()
checkHooksAndIdentity()
checkBuiltOutput(checkBundledSource())

for (const note of notes) {
  console.log(`note: ${note}`)
}
if (failures.length > 0) {
  console.error(
    `seal:rebrand-check found ${failures.length} user-visible "${branding.upstreamProductName}":\n` +
      `${failures.join('\n')}\n\n` +
      'Rebrand the copy (docs/upstream-sync.md), or allowlist an intentional mention in ' +
      'config/seal/rebrand-check/seal-rebrand-allowlist.mjs.'
  )
  process.exitCode = 1
} else {
  console.log(`seal:rebrand-check passed: no user-visible "${branding.upstreamProductName}".`)
}
