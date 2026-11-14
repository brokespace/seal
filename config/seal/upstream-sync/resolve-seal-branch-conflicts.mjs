// Run while merging a Seal branch written before the overlay (docs/upstream-sync.md). That branch
// carries Seal's name in bundled source and catalogs; the other side carries upstream's text, so
// every line naming the product conflicts.
// - Bundled source: all three sides are rebranded and the merge is redone.
// - Catalogs: the side still written in Seal's wording is taken whole.
// Both leave Seal's wording in the tree; `pnpm seal:sync:restore` then puts upstream's text back.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import process from 'node:process'

import {
  LOCALE_SURFACES,
  classifyCatalogPath,
  rebrandCatalog
} from '../brand-copy/seal-brand-catalog.mjs'
import { CODE_EXTENSIONS, rebrandSourceText } from '../brand-copy/seal-brand-source.mjs'
import { isBuildPassSource } from '../brand-copy/seal-brand-surfaces.mjs'
import branding from '../seal-branding.cjs'
import { blobText, git, mergeThreeWay, readUnmergedStages } from './unmerged-path-stages.mjs'

const root = process.cwd()
const dryRun = process.argv.includes('--dry-run')
const SEAL_NAME = new RegExp(`\\b${branding.productName}\\b`)

function sides(stages) {
  return [stages[1], stages[2], stages[3]].map((id) => blobText(root, id))
}

/** English values the rebrand changes, read from whichever side still holds upstream's text. */
function englishChangesFrom(unmerged) {
  const changes = new Map()
  for (const surface of LOCALE_SURFACES) {
    for (const path of [`${surface.dir}/en.json`, surface.runtimeRequiredPath]) {
      const stages = unmerged.get(path)
      const texts = stages ? sides(stages).slice(1) : [git(root, ['show', `:${path}`])]
      for (const text of texts) {
        if (text === null) {
          continue
        }
        for (const [from, to] of rebrandCatalog(JSON.parse(text), { locale: 'en' }).changes) {
          changes.set(from, to)
        }
      }
    }
  }
  return changes
}

function settle(path, text) {
  if (!dryRun) {
    writeFileSync(join(root, path), text)
    git(root, ['add', '--', path])
  }
}

const unmerged = readUnmergedStages(root)
const englishChanges = englishChangesFrom(unmerged)
const scratch = mkdtempSync(join(tmpdir(), 'seal-branch-merge-'))
const settled = []
const remaining = []

function rebrandSource(path, text) {
  const result = rebrandSourceText(text, path, { englishChanges })
  return result?.error ? null : (result?.code ?? text)
}

function settleCatalog(path, ours, theirs) {
  const inSealWording = [ours, theirs].filter((text) => text !== null && SEAL_NAME.test(text))
  if (inSealWording.length === 1) {
    settle(path, inSealWording[0])
    settled.push(`${path} (the side in Seal's wording)`)
  } else {
    remaining.push(`${path} (cannot tell which side predates the overlay)`)
  }
}

function settleSource(path, base, ours, theirs) {
  const brandedBase = rebrandSource(path, base)
  if (ours === null || theirs === null) {
    // One side deleted the file; that stands when the other only rebranded it.
    if (brandedBase !== null && rebrandSource(path, ours ?? theirs) === brandedBase) {
      if (!dryRun) {
        git(root, ['rm', '-q', '--', path])
      }
      settled.push(`${path} (deleted)`)
    } else {
      remaining.push(`${path} (deleted on one side, changed on the other)`)
    }
    return
  }
  const branded = {
    ours: rebrandSource(path, ours),
    base: brandedBase,
    theirs: rebrandSource(path, theirs)
  }
  if (Object.values(branded).includes(null)) {
    remaining.push(`${path} (does not parse)`)
    return
  }
  const merged = mergeThreeWay(scratch, branded, ['ours', 'base', 'theirs'])
  if (merged.conflicts === 0) {
    settle(path, merged.text)
    settled.push(path)
    return
  }
  if (!dryRun && merged.conflicts > 0) {
    writeFileSync(join(root, path), merged.text)
  }
  remaining.push(`${path} (${merged.conflicts} conflict(s) beyond the rebrand)`)
}

try {
  for (const [path, stages] of unmerged) {
    const [base, ours, theirs] = sides(stages)
    if (classifyCatalogPath(path)) {
      settleCatalog(path, ours, theirs)
    } else if (base !== null && CODE_EXTENSIONS.has(extname(path)) && isBuildPassSource(path)) {
      settleSource(path, base, ours, theirs)
    } else {
      remaining.push(path)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(`settled ${settled.length} conflict(s):\n${settled.map((p) => `  ${p}`).join('\n')}`)
console.log(
  `\n${remaining.length} conflict(s) need a person:\n${remaining.map((p) => `  ${p}`).join('\n')}`
)
console.log(
  '\nThen: pnpm seal:sync:restore --upstream=$(git merge-base HEAD upstream/main) && pnpm seal:regenerate'
)
process.exitCode = remaining.length > 0 ? 1 : 0
