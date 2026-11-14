// Run during `git merge upstream/main` (docs/upstream-sync.md). Settles the conflicts that are
// only the rebrand: a file Seal rebranded in place conflicts wherever upstream touched a line that
// names the product, so both upstream sides are rebranded first and the merge is redone; whatever
// still conflicts is a real one and is left for a person, with the reduced conflict written out.
// Generated files take upstream's side and are rebuilt by regenerate-generated-files.mjs.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { rebrandInPlaceText } from '../brand-copy/apply-seal-brand-copy.mjs'
import { readEnglishBrandChanges } from '../brand-copy/seal-brand-catalog.mjs'
import { GENERATED_FILES, RELEASED_DIGESTS_PATH } from './generated-files.mjs'

const root = process.cwd()
const dryRun = process.argv.includes('--dry-run')

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 30 })
}

/** Unmerged paths with the blob of each side: 1 base, 2 ours (Seal), 3 theirs (upstream). */
function unmergedPaths() {
  const byPath = new Map()
  for (const entry of git(['ls-files', '--unmerged', '-z']).split('\0')) {
    const match = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry)
    if (match) {
      const stages = byPath.get(match[3]) ?? {}
      stages[match[2]] = match[1]
      byPath.set(match[3], stages)
    }
  }
  return byPath
}

function blob(id) {
  return id ? git(['cat-file', 'blob', id]) : null
}

function unionDigests(ours, theirs) {
  const skills = { ...ours.skills }
  for (const [name, digests] of Object.entries(theirs.skills)) {
    skills[name] = [...new Set([...(skills[name] ?? []), ...digests])].sort()
  }
  const sorted = Object.fromEntries(Object.entries(skills).sort(([a], [b]) => (a < b ? -1 : 1)))
  return `${JSON.stringify({ ...theirs, skills: sorted }, null, 2)}\n`
}

function mergeFile(scratch, ours, base, theirs) {
  const paths = ['ours', 'base', 'theirs'].map((name) => join(scratch, name))
  ;[ours, base, theirs].forEach((text, index) => writeFileSync(paths[index], text))
  const result = spawnSync(
    'git',
    ['merge-file', '-p', '-L', 'seal', '-L', 'base', '-L', 'upstream', ...paths],
    { encoding: 'utf8', maxBuffer: 2 ** 30 }
  )
  return { text: result.stdout, conflicts: result.status }
}

function settle(path, text) {
  if (!dryRun) {
    writeFileSync(join(root, path), text)
    git(['add', '--', path])
  }
}

const englishChanges = readEnglishBrandChanges(root)
const scratch = mkdtempSync(join(tmpdir(), 'seal-brand-merge-'))
const settled = []
const remaining = []
try {
  for (const [path, stages] of unmergedPaths()) {
    const [base, ours, theirs] = [stages[1], stages[2], stages[3]].map(blob)
    if (path === RELEASED_DIGESTS_PATH && ours !== null && theirs !== null) {
      // The ledger is add-only: both sides' digests are installs that exist somewhere.
      settle(path, unionDigests(JSON.parse(ours), JSON.parse(theirs)))
      settled.push(`${path} (union; regenerate)`)
      continue
    }
    if (GENERATED_FILES.includes(path) && theirs !== null) {
      settle(path, theirs)
      settled.push(`${path} (upstream's; regenerate)`)
      continue
    }
    if (base === null || ours === null) {
      remaining.push(`${path} (added on both sides or deleted by Seal)`)
      continue
    }
    const brandedBase = rebrandInPlaceText(path, base, englishChanges)
    if (theirs === null) {
      // Upstream deleted a file Seal only rebranded.
      if (brandedBase === ours) {
        if (!dryRun) {
          git(['rm', '-q', '--', path])
        }
        settled.push(`${path} (deleted upstream)`)
      } else {
        remaining.push(`${path} (deleted upstream, changed by Seal)`)
      }
      continue
    }
    const brandedTheirs = rebrandInPlaceText(path, theirs, englishChanges)
    if (brandedBase === null || brandedTheirs === null) {
      remaining.push(path)
      continue
    }
    const merged = mergeFile(scratch, ours, brandedBase, brandedTheirs)
    if (merged.conflicts === 0) {
      settle(path, merged.text)
      settled.push(path)
    } else {
      if (!dryRun && merged.conflicts > 0) {
        writeFileSync(join(root, path), merged.text)
      }
      remaining.push(`${path} (${merged.conflicts} conflict(s) beyond the rebrand)`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(`settled ${settled.length} conflict(s):\n${settled.map((p) => `  ${p}`).join('\n')}`)
console.log(
  `\n${remaining.length} conflict(s) need a person:\n${remaining.map((p) => `  ${p}`).join('\n')}`
)
process.exitCode = remaining.length > 0 ? 1 : 0
