// Classifies every remaining case-sensitive "Orca" in tracked files, so a rebrand audit can
// tell intentional upstream names from missed copy. Writes markdown to stdout or `--out=<file>`.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import process from 'node:process'
import { parseSync } from 'oxc-parser'

import { SKIPPED_SOURCE_FILES } from './apply-seal-brand-copy.mjs'
import { findBrandMentions } from './seal-brand-copy.mjs'

const CATEGORIES = {
  attribution:
    'Attribution: fork notice, upstream README, GNOME Orca screen reader, upstream links',
  skills: 'Agent-facing skills and CLI contract (managed terminals only guarantee `orca`)',
  generated: 'Generated from upstream-named sources or skill guides',
  pluginContract: 'Plugin API contract: type names, `engines.orca`, plugin file formats',
  upstreamData: 'Upstream distribution or service data (casks, pinned releases, marketplace)',
  translationTooling: 'Upstream translation tooling keyed by upstream English',
  tests: 'Tests, fixtures, goldens and recordings',
  comment: 'Code comments (not shipped as UI)',
  identifier: 'Identifiers: types, functions, modules, native module names',
  wireIdentity: 'Wire/persisted identities: markers, TERM_PROGRAM, User-Agent, clientInfo, fonts',
  devOnly: 'Dev-only names and engineering records (Orca Dev, reliability gates, benchmarks)',
  ci: 'CI and release-pipeline text that only maintainers see',
  engineeringDocs: 'Engineering docs describing upstream internals, code, or history',
  versionCompat: 'Upstream version requirements (e.g. "needs Orca 1.4.248")',
  compat: 'Upstream-compat names: legacy binary candidates and install paths',
  packageMetadata: 'Package and podspec metadata (never shown in the app)',
  dependencyPatches: 'Patches applied to third-party dependencies',
  review: 'NEEDS REVIEW: user-visible string not covered by another category'
}

const PATH_RULES = [
  [/^(README\.md|docs\/UPSTREAM\.md)$|(^|\/)[^/]*(LICENSE|NOTICES?)[^/]*$/, 'attribution'],
  [
    /^(skills|skill-guides|skill-stubs|resources\/native-chat-visuals)\/|\.skill-md\.txt$/,
    'skills'
  ],
  [
    /^(src\/cli\/skills\/bundled-skill-guides\.ts|src\/main\/skills\/bundled-skill-install\/bundled-skill-sources\.ts)$/,
    'generated'
  ],
  [/^(docs\/schemas|resources\/plugins\/(types|declarative))\//, 'pluginContract'],
  [
    /^(Casks\/|cloud\/|\.github\/actions\/download-pinned-orca-release|resources\/plugins\/launch\/|config\/scripts\/diagnostics\/macos-launch\/)/,
    'upstreamData'
  ],
  [/^examples\/plugins\//, 'versionCompat'],
  [/^resources\/linux\/bin\//, 'compat'],
  [/^config\/scripts\/locale-catalog\//, 'translationTooling'],
  [/^(config|mobile)\/patches\//, 'dependencyPatches'],
  [
    /(\.test\.|\.spec\.|(^|\/)tests?\/|__tests__|__fixtures__|__goldens__|(^|\/)fixtures\/|\/testing\/|test-fixture|test-support|\/goldens\/|pilot-scenarios|e2e\/|(^|\/)mock-[^/]*\.html$)/,
    'tests'
  ],
  [/(^|\/)package\.json$|\.podspec$/, 'packageMetadata'],
  [
    /^(config\/(reliability-gates\.jsonc|benchmarks\/|ci\/|build-plugins\/|agent-plugins\/|dependency-security-exceptions\.json)|config\/scripts\/(development|skills|static-analysis\/branding)\/|mobile\/scripts\/|src\/main\/runtime\/agent-state-rules\/)/,
    'devOnly'
  ],
  [/^(\.github\/(workflows|actions)\/|mobile\/fastlane\/)/, 'ci'],
  [/^docs\/|\.md$/, 'engineeringDocs']
]
const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const LINE_COMMENT = /^\s*(\/\/|#|\*|\/\*|<!--|--|;|')|\s(\/\/|#)\s/
const WIRE_IDENTITY =
  /TERM_PROGRAM|User-Agent|clientInfo|Nerd Font|Terminal Symbols|\[Orca:|Orca-generated|Managed by Orca|orca-managed|BEGIN ORCA|END ORCA|Orca managed/

function trackedMatches() {
  const out = execFileSync('git', ['grep', '-n', '-I', '--no-color', 'Orca'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28
  })
  const byFile = new Map()
  for (const line of out.split('\n')) {
    const match = /^([^:]+):(\d+):(.*)$/.exec(line)
    if (!match) {
      continue
    }
    const [, file, lineNumber, text] = match
    if (!byFile.has(file)) {
      byFile.set(file, [])
    }
    byFile.get(file).push({ line: Number(lineNumber), text })
  }
  return byFile
}

function jsRanges(file) {
  const code = readFileSync(file, 'utf8')
  let result
  try {
    result = parseSync(file, code)
  } catch {
    return null
  }
  const lineStarts = [0]
  for (let index = 0; index < code.length; index++) {
    if (code[index] === '\n') {
      lineStarts.push(index + 1)
    }
  }
  const comments = result.comments.map((comment) => [comment.start, comment.end])
  const strings = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (
      (node.type === 'Literal' && typeof node.value === 'string') ||
      node.type === 'TemplateElement' ||
      node.type === 'JSXText'
    ) {
      strings.push([node.start, node.end])
    }
    for (const key in node) {
      if (key !== 'parent') {
        visit(node[key])
      }
    }
  }
  visit(result.program)
  return { code, lineStarts, comments, strings }
}

function inRanges(ranges, offset) {
  return ranges.some(([start, end]) => offset >= start && offset < end)
}

function classifyJsLine(ranges, entry) {
  const lineStart = ranges.lineStarts[entry.line - 1]
  const lineText = ranges.code.slice(lineStart, ranges.lineStarts[entry.line] ?? ranges.code.length)
  const kinds = new Set()
  let literalContext = ''
  for (const match of lineText.matchAll(/Orca/g)) {
    const offset = lineStart + match.index
    const literal = ranges.strings.find(([start, end]) => offset >= start && offset < end)
    if (inRanges(ranges.comments, offset)) {
      kinds.add('comment')
    } else if (literal) {
      kinds.add('string')
      // The binding name before the literal tells markers apart from copy.
      literalContext += ranges.code.slice(Math.max(0, literal[0] - 80), literal[1])
    } else {
      kinds.add('identifier')
    }
  }
  return { kinds, literalContext }
}

const MARKER_BINDING = /MARKER|SENTINEL|USER_AGENT|TERM_PROGRAM/

function classifyString(file, text, literalContext = '') {
  if (
    SKIPPED_SOURCE_FILES.has(file) ||
    WIRE_IDENTITY.test(text) ||
    WIRE_IDENTITY.test(literalContext) ||
    MARKER_BINDING.test(literalContext)
  ) {
    return 'wireIdentity'
  }
  if (/Orca Dev|OrcaDev/.test(text)) {
    return 'devOnly'
  }
  if (findBrandMentions(text).length === 0) {
    // Only identifier-shaped or attribution mentions remain inside the literal.
    return 'identifier'
  }
  return 'review'
}

function isPythonDocstring(file, entry) {
  const before = readFileSync(file, 'utf8').split('\n').slice(0, entry.line).join('\n')
  return ((before.match(/"""/g) ?? []).length & 1) === 1
}

function classify(file, entry, jsCache) {
  for (const [pattern, category] of PATH_RULES) {
    if (pattern.test(file)) {
      return category
    }
  }
  if (
    /GNOME['’]?s? Orca|Orca screen reader|forked? (of|from) Orca|(Modifications|Adapted) by Orca/.test(
      entry.text
    )
  ) {
    return 'attribution'
  }
  if (JS_EXTENSIONS.has(extname(file))) {
    if (!jsCache.has(file)) {
      jsCache.set(file, jsRanges(file))
    }
    const ranges = jsCache.get(file)
    if (ranges) {
      const { kinds, literalContext } = classifyJsLine(ranges, entry)
      if (kinds.has('string')) {
        return classifyString(file, entry.text, literalContext)
      }
      return kinds.has('identifier') ? 'identifier' : 'comment'
    }
  }
  if (
    LINE_COMMENT.test(entry.text) ||
    (extname(file) === '.py' && isPythonDocstring(file, entry))
  ) {
    return 'comment'
  }
  if (WIRE_IDENTITY.test(entry.text)) {
    return 'wireIdentity'
  }
  if (findBrandMentions(entry.text).length === 0) {
    return 'identifier'
  }
  return 'review'
}

const byFile = trackedMatches()
const jsCache = new Map()
const grouped = new Map(Object.keys(CATEGORIES).map((key) => [key, []]))
for (const [file, entries] of byFile) {
  for (const entry of entries) {
    grouped.get(classify(file, entry, jsCache)).push(`${file}:${entry.line}: ${entry.text.trim()}`)
  }
}

const total = [...grouped.values()].reduce((sum, lines) => sum + lines.length, 0)
const lines = [
  '# Remaining "Orca" occurrences',
  '',
  `${total} matching lines in ${byFile.size} tracked files (case-sensitive \`Orca\`).`,
  'Lowercase `orca` (the CLI alias, `~/.orca`, `orca://`, `orcad`, package and file names) is kept for upstream compatibility and not listed.',
  '',
  '| Category | Lines | Justification |',
  '| --- | ---: | --- |',
  ...[...grouped].map(([key, items]) => `| \`${key}\` | ${items.length} | ${CATEGORIES[key]} |`),
  ''
]
for (const [key, items] of grouped) {
  if (items.length === 0) {
    continue
  }
  lines.push(`## ${key} (${items.length})`, '', CATEGORIES[key], '', '```text')
  lines.push(...items.map((item) => (item.length > 240 ? `${item.slice(0, 240)}…` : item)))
  lines.push('```', '')
}
const report = lines.join('\n')
const outArg = process.argv.find((arg) => arg.startsWith('--out='))
if (outArg) {
  writeFileSync(outArg.slice('--out='.length), report)
  console.log(lines.slice(0, 7 + grouped.size).join('\n'))
} else {
  console.log(report)
}
