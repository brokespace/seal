// Vite/Rolldown plugin: source files and locale catalogs stay upstream's on disk and are rebranded
// as they are loaded, for the desktop app, the web client, dev servers and Vitest alike.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  classifyCatalogPath,
  createSurfaceCatalogBuilder,
  readEnglishBrandChanges
} from './seal-brand-catalog.mjs'
import { CODE_EXTENSIONS, mayContainBrandCopy, rebrandSourceText } from './seal-brand-source.mjs'
import { isBuildPassSource } from './seal-brand-surfaces.mjs'

// Not the working directory: mobile's Vitest and Metro run from mobile/.
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\\/]$/, '')
// `?url` catalogs are read from disk by Vite's asset pipeline, so they need a real file.
const GENERATED_CATALOG_DIR = join('.cache', 'seal', 'brand-catalogs')
// Wrapper modules for these queries are not the file's own source.
const NON_SOURCE_QUERY = /(?:^|&)(?:url|raw|worker|sharedworker|inline|no-inline)(?:&|=|$)/

function splitId(id) {
  const queryStart = id.indexOf('?')
  return queryStart === -1 ? [id, ''] : [id.slice(0, queryStart), id.slice(queryStart + 1)]
}

/** Shared by every bundler adapter: the rebrand of one module or catalog, given its path. */
export function createSealBrandPass(root = REPO_ROOT) {
  let englishChanges
  const builders = new Map()

  function repoRelative(file) {
    if (!isAbsolute(file)) {
      return null
    }
    const path = relative(root, file)
    if (path.startsWith('..') || isAbsolute(path)) {
      return null
    }
    const normalized = sep === '/' ? path : path.split(sep).join('/')
    return normalized.includes('node_modules/') ? null : normalized
  }

  function builderFor(surface) {
    if (!builders.has(surface.name)) {
      builders.set(surface.name, createSurfaceCatalogBuilder(root, surface))
    }
    return builders.get(surface.name)
  }

  function brandCatalog(catalogPath, upstream) {
    const builder = builderFor(catalogPath.surface)
    return catalogPath.kind === 'runtime-required'
      ? builder.buildRuntimeRequiredCatalog(upstream)
      : builder.buildLocaleCatalog(upstream, catalogPath.locale)
  }

  return {
    repoRelative,
    catalogPath(file) {
      const path = repoRelative(file)
      return path === null ? null : classifyCatalogPath(path)
    },
    /** JSON text of what ships for a catalog whose upstream text (or a subset) is `text`. */
    brandCatalogText(catalogPath, text) {
      return JSON.stringify(brandCatalog(catalogPath, JSON.parse(text)))
    },
    /** Writes the shipped catalog for `file` under .cache and returns that path. */
    writeGeneratedCatalog(catalogPath, file) {
      const generated = join(
        root,
        GENERATED_CATALOG_DIR,
        catalogPath.surface.name,
        'i18n',
        'locales',
        `${catalogPath.locale}.json`
      )
      const next = JSON.stringify(brandCatalog(catalogPath, JSON.parse(readFileSync(file, 'utf8'))))
      let current = null
      try {
        current = readFileSync(generated, 'utf8')
      } catch {
        // First build of this catalog.
      }
      if (current !== next) {
        mkdirSync(dirname(generated), { recursive: true })
        // Parallel builds share the cache; a rename never exposes a half-written catalog.
        const scratch = `${generated}.${process.pid}.tmp`
        writeFileSync(scratch, next)
        renameSync(scratch, generated)
      }
      return generated
    },
    /** Rebranded module text, or null when `file` is not Seal-rebranded source or is unchanged. */
    brandSource(file, code) {
      if (!CODE_EXTENSIONS.has(extname(file)) || !mayContainBrandCopy(code)) {
        return null
      }
      const path = repoRelative(file)
      if (path === null || !isBuildPassSource(path)) {
        return null
      }
      englishChanges ??= readEnglishBrandChanges(root)
      const result = rebrandSourceText(code, path, { englishChanges })
      return result && !result.error ? result.code : null
    }
  }
}

/** @returns {import('vite').Plugin} */
export function sealBrandCopy({ root = REPO_ROOT } = {}) {
  const pass = createSealBrandPass(root)
  return {
    name: 'seal-brand-copy',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!/\.json\?(?:.*&)?url(?:&|$)/.test(source)) {
        return null
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) {
        return null
      }
      const [file, query] = splitId(resolved.id)
      const catalogPath = pass.catalogPath(file)
      if (!catalogPath || catalogPath.kind !== 'locale') {
        return null
      }
      return `${pass.writeGeneratedCatalog(catalogPath, file)}?${query}`
    },
    transform(code, id) {
      const [file, query] = splitId(id)
      if (NON_SOURCE_QUERY.test(query)) {
        return null
      }
      if (file.endsWith('.json')) {
        const catalogPath = pass.catalogPath(file)
        return catalogPath ? { code: pass.brandCatalogText(catalogPath, code), map: null } : null
      }
      const branded = pass.brandSource(file, code)
      // "Orca" and "Seal" are the same length, so positions hold and the prior map stays valid.
      return branded === null ? null : { code: branded, map: null }
    }
  }
}
