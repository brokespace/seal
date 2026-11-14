import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LOCALE_CATALOG_DIRS, RUNTIME_REQUIRED_CATALOGS } from './apply-seal-brand-copy.mjs'
import { BRAND_ATTRIBUTION_ALLOWLIST } from './seal-brand-copy.mjs'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
// mobile/app.json carries the store name and native permission prompts.
const NATIVE_COPY_FILES = ['mobile/app.json']

function catalogFiles() {
  return [
    ...LOCALE_CATALOG_DIRS.flatMap(({ dir }) =>
      readdirSync(join(repoRoot, dir))
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(dir, name))
    ),
    ...RUNTIME_REQUIRED_CATALOGS.map(({ path }) => path),
    ...NATIVE_COPY_FILES
  ]
}

function* stringEntries(value, path) {
  if (typeof value === 'string') {
    yield [path, value]
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      yield* stringEntries(child, `${path}.${key}`)
    }
  }
}

function withoutAttribution(text) {
  return BRAND_ATTRIBUTION_ALLOWLIST.reduce(
    (rest, phrase) => rest.replace(new RegExp(phrase.source, 'gi'), ''),
    text
  )
}

describe('Seal locale branding', () => {
  it('keeps the upstream Orca name out of user-visible locale strings', () => {
    const mentions = []
    for (const file of catalogFiles()) {
      for (const [path, value] of stringEntries(
        JSON.parse(readFileSync(join(repoRoot, file), 'utf8')),
        ''
      )) {
        if (withoutAttribution(value).includes('Orca')) {
          mentions.push(`${file}${path}: ${value}`)
        }
      }
    }
    expect(mentions).toEqual([])
  })

  it('still allows attribution to upstream Orca', () => {
    expect(withoutAttribution('Seal is forked from Orca by Stably.')).not.toContain('Orca')
    expect(withoutAttribution('Open Orca settings')).toContain('Orca')
  })
})
