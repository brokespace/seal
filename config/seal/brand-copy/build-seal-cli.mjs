#!/usr/bin/env node
// `pnpm build:cli`: upstream's CLI build, then the brand pass over the modules it just emitted.
// The CLI is emitted file by file with no bundler, so the pass runs on the output instead.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { buildCli } from '../../scripts/cli-build/build-cli.mjs'
import { readEnglishBrandChanges } from './seal-brand-catalog.mjs'
import { mayContainBrandCopy, rebrandSourceText } from './seal-brand-source.mjs'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
// Filesystem timestamps can be coarser than the clock.
const TIMESTAMP_SLACK_MS = 2000

function* emittedModules(dir, emittedSince) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* emittedModules(path, emittedSince)
    } else if (entry.name.endsWith('.js') && statSync(path).mtimeMs >= emittedSince) {
      yield path
    }
  }
}

/**
 * Rebrands the modules emitted into `outDir` since `emittedSince`. Older files there are other
 * builds' bundles, already rebranded by their own bundler.
 */
export function rebrandEmittedModules({ root = ROOT, outDir = 'out', emittedSince }) {
  const englishChanges = readEnglishBrandChanges(root)
  const outRoot = join(root, outDir)
  let rebranded = 0
  for (const path of emittedModules(outRoot, emittedSince)) {
    const code = readFileSync(path, 'utf8')
    if (!mayContainBrandCopy(code)) {
      continue
    }
    // Path rules are written against the source tree the module was emitted from.
    const sourcePath = `src/${relative(outRoot, path).split(sep).join('/')}`.replace(/\.js$/, '.ts')
    const result = rebrandSourceText(code, sourcePath, { englishChanges, parsePath: path })
    if (result?.error) {
      throw new Error(`Seal brand pass could not parse ${path}: ${result.error}`)
    }
    if (result) {
      writeFileSync(path, result.code)
      rebranded += 1
    }
  }
  return rebranded
}

if (process.argv[1] === import.meta.filename) {
  try {
    const emittedSince = Date.now() - TIMESTAMP_SLACK_MS
    await buildCli()
    const rebranded = rebrandEmittedModules({ emittedSince })
    console.log(`Seal brand pass: ${rebranded} emitted CLI module(s) rebranded`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
