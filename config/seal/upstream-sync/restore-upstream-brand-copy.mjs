#!/usr/bin/env node
// Puts files the build pass rebrands back to upstream's text, and moves catalog differences into
// Seal's overlay. A file changes only when rebranding the result reproduces what is in the tree
// now, so what ships stays byte-identical.
//   node config/seal/upstream-sync/restore-upstream-brand-copy.mjs --upstream=<ref> [--dry-run]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import process from 'node:process'

import {
  LOCALE_SURFACES,
  REMOVED_KEYS_FILE,
  catalogDifference,
  englishCommandKeys,
  mergeCatalogOverlay,
  readRemovedKeys,
  rebrandCatalog,
  removedKeyNames
} from '../brand-copy/seal-brand-catalog.mjs'
import {
  CODE_EXTENSIONS,
  rebrandSourceText,
  restoreUpstreamLiterals
} from '../brand-copy/seal-brand-source.mjs'
import { isBuildPassSource } from '../brand-copy/seal-brand-surfaces.mjs'

const root = process.cwd()
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const upstreamRef = args.find((arg) => arg.startsWith('--upstream='))?.slice('--upstream='.length)
if (!upstreamRef) {
  console.error('Pass --upstream=<ref>, e.g. --upstream=$(git merge-base HEAD upstream/main)')
  process.exit(2)
}

function git(gitArgs, options = {}) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 1 << 30, ...options })
}

function showUpstream(path) {
  try {
    return git(['show', `${upstreamRef}:${path}`])
  } catch {
    return null
  }
}

function formatCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

function restoreCatalogs() {
  let restored = 0
  for (const surface of LOCALE_SURFACES) {
    const upstreamEnglish = showUpstream(`${surface.dir}/en.json`)
    if (upstreamEnglish === null) {
      continue
    }
    const commandKeys = englishCommandKeys(JSON.parse(upstreamEnglish))
    const files = git(['ls-files', '--', surface.dir, surface.runtimeRequiredPath])
      .split('\n')
      .filter((path) => path.endsWith('.json'))
    for (const path of files) {
      const upstreamText = showUpstream(path)
      const currentText = readFileSync(join(root, path), 'utf8')
      if (upstreamText === null || upstreamText === currentText) {
        continue
      }
      const runtimeRequired = path === surface.runtimeRequiredPath
      const locale = runtimeRequired ? 'en' : path.slice(surface.dir.length + 1, -'.json'.length)
      const overlayPath = join(root, surface.overlayDir, `${locale}.json`)
      let overlay = {}
      try {
        overlay = JSON.parse(readFileSync(overlayPath, 'utf8'))
      } catch {
        // No overlay yet for this locale.
      }
      const brandOptions = { locale, commandKeys: runtimeRequired ? new Set() : commandKeys }
      const { catalog: rebranded } = rebrandCatalog(JSON.parse(upstreamText), brandOptions)
      // The file may hold upstream's text or Seal's; rebranding makes both read as what ships.
      const { catalog: current } = rebrandCatalog(JSON.parse(currentText), brandOptions)
      // An edit made in upstream's file is newer than the overlay's value for the same key.
      const editedInPlace = catalogDifference(rebranded, current)
      const shippedNow = mergeCatalogOverlay(mergeCatalogOverlay(current, overlay), editedInPlace)
      // The boot bundle carries the whole English overlay, so its own differences fold into it.
      const nextOverlay = mergeCatalogOverlay(overlay, catalogDifference(rebranded, shippedNow))
      if (runtimeRequired && JSON.stringify(nextOverlay) === JSON.stringify(overlay)) {
        // Generated from Seal's source, so it may lack upstream keys; seal:regenerate owns it.
        continue
      }
      restored += 1
      console.log(`catalog: ${path} -> upstream (+ ${surface.overlayDir}/${locale}.json)`)
      if (locale === 'en' && !runtimeRequired) {
        // Keys this branch deleted from upstream's English file stay deleted in what ships.
        const removed = new Set([
          ...readRemovedKeys(root, surface),
          ...removedKeyNames(JSON.parse(upstreamText), shippedNow)
        ])
        console.log(`catalog: ${removed.size} removed upstream keys for ${surface.name}`)
        if (!dryRun && removed.size > 0) {
          mkdirSync(join(root, surface.overlayDir), { recursive: true })
          writeFileSync(
            join(root, surface.overlayDir, REMOVED_KEYS_FILE),
            formatCatalog([...removed].toSorted())
          )
        }
      }
      if (!dryRun) {
        if (Object.keys(nextOverlay).length > 0) {
          mkdirSync(dirname(overlayPath), { recursive: true })
          writeFileSync(overlayPath, formatCatalog(nextOverlay))
        }
        writeFileSync(join(root, path), upstreamText)
      }
    }
  }
  return restored
}

function englishChangesAtUpstream() {
  const changes = new Map()
  for (const surface of LOCALE_SURFACES) {
    for (const path of [`${surface.dir}/en.json`, surface.runtimeRequiredPath]) {
      const text = showUpstream(path)
      if (text === null) {
        continue
      }
      for (const [from, to] of rebrandCatalog(JSON.parse(text), { locale: 'en' }).changes) {
        changes.set(from, to)
      }
    }
  }
  return changes
}

function rebrand(code, path, englishChanges) {
  const result = rebrandSourceText(code, path, { englishChanges })
  if (result?.error) {
    return null
  }
  return result?.code ?? code
}

function restoreSources() {
  const englishChanges = englishChangesAtUpstream()
  const counts = { upstream: 0, reduced: 0 }
  const changed = git(['diff', '--name-only', '--diff-filter=M', upstreamRef, '--'])
    .split('\n')
    .filter((path) => CODE_EXTENSIONS.has(extname(path)) && isBuildPassSource(path))
  for (const path of changed) {
    const upstream = showUpstream(path)
    const current = readFileSync(join(root, path), 'utf8')
    const shipped = rebrand(current, path, englishChanges)
    if (upstream === null || shipped === null) {
      continue
    }
    let next = null
    if (rebrand(upstream, path, englishChanges) === shipped) {
      next = upstream
      counts.upstream += 1
    } else {
      const candidate = restoreUpstreamLiterals(current, upstream, path, { englishChanges })
      if (candidate !== current && rebrand(candidate, path, englishChanges) === shipped) {
        next = candidate
        counts.reduced += 1
      }
    }
    if (next !== null && next !== current && !dryRun) {
      writeFileSync(join(root, path), next)
    }
  }
  console.log(
    `sources: ${counts.upstream} match upstream, ${counts.reduced} reduced to their Seal changes`
  )
}

console.log(`catalogs: ${restoreCatalogs()} restored`)
restoreSources()
