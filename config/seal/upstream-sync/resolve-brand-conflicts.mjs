// Run during `git merge upstream/main` (docs/upstream-sync.md). Settles the conflicts that are
// only the rebrand: a file Seal rebranded in place conflicts wherever upstream touched a line that
// names the product, so both upstream sides are rebranded first and the merge is redone; whatever
// still conflicts is a real one and is left for a person, with the reduced conflict written out.
// Generated files take upstream's side and are rebuilt by regenerate-generated-files.mjs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { rebrandInPlaceText } from '../brand-copy/apply-seal-brand-copy.mjs'
import { readEnglishBrandChanges } from '../brand-copy/seal-brand-catalog.mjs'
import { GENERATED_FILES, RELEASED_DIGESTS_PATH } from './generated-files.mjs'
import { blobText, git, mergeThreeWay, readUnmergedStages } from './unmerged-path-stages.mjs'

const root = process.cwd()
const dryRun = process.argv.includes('--dry-run')

function unionDigests(ours, theirs) {
  const skills = { ...ours.skills }
  for (const [name, digests] of Object.entries(theirs.skills)) {
    skills[name] = [...new Set([...(skills[name] ?? []), ...digests])].sort()
  }
  const sorted = Object.fromEntries(Object.entries(skills).sort(([a], [b]) => (a < b ? -1 : 1)))
  return `${JSON.stringify({ ...theirs, skills: sorted }, null, 2)}\n`
}

function settle(path, text) {
  if (!dryRun) {
    writeFileSync(join(root, path), text)
    git(root, ['add', '--', path])
  }
}

const englishChanges = readEnglishBrandChanges(root)
const scratch = mkdtempSync(join(tmpdir(), 'seal-brand-merge-'))
const settled = []
const remaining = []
try {
  for (const [path, stages] of readUnmergedStages(root)) {
    const [base, ours, theirs] = [stages[1], stages[2], stages[3]].map((id) => blobText(root, id))
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
          git(root, ['rm', '-q', '--', path])
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
    const merged = mergeThreeWay(scratch, { ours, base: brandedBase, theirs: brandedTheirs }, [
      'seal',
      'base',
      'upstream'
    ])
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
