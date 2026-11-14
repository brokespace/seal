// `node:fs/promises` for upstream's localization gates. Upstream's catalogs stay untouched on disk
// and Seal's strings live in an overlay, so the gates read each catalog as Seal declares it:
// without the upstream keys Seal's UI dropped, with the overlay laid over the rest. What `--fix`
// writes back is split again: upstream's own keys to upstream's file, Seal's keys and rewordings
// to the overlay. A tree with no overlay (upstream's tests, plugin catalogs) reads and writes as
// usual.
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  LOCALE_SURFACES,
  REMOVED_KEYS_FILE,
  mergeCatalogOverlay,
  withoutRemovedKeys
} from '../brand-copy/seal-brand-catalog.mjs'

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The catalog a path names and where its tree keeps the overlay and upstream English. */
function catalogTarget(file) {
  if (typeof file !== 'string' || !file.endsWith('.json')) {
    return null
  }
  const normalized = path.resolve(file).split(path.sep).join('/')
  for (const surface of LOCALE_SURFACES) {
    const runtimeRequired = normalized.endsWith(`/${surface.runtimeRequiredPath}`)
    const localeDirAt = normalized.lastIndexOf(`/${surface.dir}/`)
    let locale = null
    let root = null
    if (runtimeRequired) {
      locale = 'en'
      root = normalized.slice(0, -surface.runtimeRequiredPath.length - 1)
    } else if (localeDirAt !== -1) {
      const name = normalized.slice(localeDirAt + surface.dir.length + 2)
      if (!name.includes('/') && !name.startsWith('.')) {
        locale = name.slice(0, -'.json'.length)
        root = normalized.slice(0, localeDirAt)
      }
    }
    if (locale !== null) {
      return {
        runtimeRequired,
        overlayPath: path.join(root, surface.overlayDir, `${locale}.json`),
        englishOverlayPath: path.join(root, surface.overlayDir, 'en.json'),
        removedKeysPath: path.join(root, surface.overlayDir, REMOVED_KEYS_FILE),
        englishPath: path.join(root, surface.dir, 'en.json')
      }
    }
  }
  return null
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/** Null unless this tree is Seal's, which always has an English overlay. */
async function readSealView(target) {
  if (!target || (await readJsonIfPresent(target.englishOverlayPath)) === null) {
    return null
  }
  return {
    overlay: (await readJsonIfPresent(target.overlayPath)) ?? {},
    removedKeys: new Set((await readJsonIfPresent(target.removedKeysPath)) ?? []),
    english: (await readJsonIfPresent(target.englishPath)) ?? {}
  }
}

function formatCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

/** Whether `reference` declares `key`, in any plural form. */
function declares(reference, key) {
  if (!isPlainObject(reference)) {
    return false
  }
  const base = key.replace(PLURAL_SUFFIX, '')
  return Object.keys(reference).some(
    (name) => name === key || name.replace(PLURAL_SUFFIX, '') === base
  )
}

/** Splits a catalog into the keys `reference` declares and the ones it does not. */
function splitByDeclared(catalog, reference) {
  const declared = {}
  const undeclared = {}
  for (const [key, value] of Object.entries(catalog)) {
    if (isPlainObject(value)) {
      const child = splitByDeclared(value, isPlainObject(reference) ? reference[key] : undefined)
      if (Object.keys(child.declared).length > 0) {
        declared[key] = child.declared
      }
      if (Object.keys(child.undeclared).length > 0) {
        undeclared[key] = child.undeclared
      }
    } else if (declares(reference, key)) {
      declared[key] = value
    } else {
      undeclared[key] = value
    }
  }
  return { declared, undeclared }
}

async function readFile(file, options) {
  const text = await fs.readFile(file, options)
  const view = typeof text === 'string' ? await readSealView(catalogTarget(file)) : null
  if (!view) {
    return text
  }
  return formatCatalog(
    mergeCatalogOverlay(withoutRemovedKeys(JSON.parse(text), view.removedKeys), view.overlay)
  )
}

async function writeFile(file, data, options) {
  const target = typeof data === 'string' ? catalogTarget(file) : null
  const view = await readSealView(target)
  if (!view) {
    return fs.writeFile(file, data, options)
  }
  const byOwner = splitByDeclared(JSON.parse(data), view.english)
  // An upstream key the overlay rewords is Seal's value; upstream's own stays in its file.
  const upstreamKeys = splitByDeclared(byOwner.declared, view.overlay)
  if (!target.runtimeRequired) {
    const nextOverlay = mergeCatalogOverlay(
      view.overlay,
      mergeCatalogOverlay(byOwner.undeclared, upstreamKeys.declared)
    )
    if (JSON.stringify(nextOverlay) !== JSON.stringify(view.overlay)) {
      await fs.writeFile(target.overlayPath, formatCatalog(nextOverlay))
    }
  }
  // Upstream's file changes only when its own keys did; the keys Seal hides or rewords stay in it.
  const onDisk = (await readJsonIfPresent(file)) ?? {}
  const shown = splitByDeclared(
    withoutRemovedKeys(onDisk, view.removedKeys),
    view.overlay
  ).undeclared
  if (JSON.stringify(upstreamKeys.undeclared) !== JSON.stringify(shown)) {
    const kept = splitByDeclared(onDisk, shown).undeclared
    await fs.writeFile(
      file,
      formatCatalog(mergeCatalogOverlay(upstreamKeys.undeclared, kept)),
      options
    )
  }
  return undefined
}

// Everything else is node:fs/promises itself.
export default Object.assign(Object.create(fs), { readFile, writeFile })
