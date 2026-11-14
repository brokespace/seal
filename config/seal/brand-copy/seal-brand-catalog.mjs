// Locale catalogs stay upstream's on disk. What ships is upstream's catalog with the product name
// rewritten, then Seal's overlay (Seal-only keys and hand-written replacements) laid on top.
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { rebrandCopy, rebrandLocalizedCommands } from './seal-brand-copy.mjs'

/** Catalog surfaces: `dir` is upstream's, `overlayDir` is Seal's. */
export const LOCALE_SURFACES = [
  {
    name: 'desktop',
    dir: 'src/renderer/src/i18n/locales',
    overlayDir: 'src/renderer/src/i18n/seal-overrides',
    runtimeRequiredPath: 'src/renderer/src/i18n/en-runtime-required.json'
  },
  {
    name: 'mobile',
    dir: 'mobile/src/i18n/locales',
    overlayDir: 'mobile/src/i18n/seal-overrides',
    runtimeRequiredPath: 'mobile/src/i18n/en-runtime-required.json'
  }
]

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rebrandTree(value, context, path) {
  if (typeof value === 'string') {
    let next = rebrandCopy(value, { locale: context.locale, commands: true })
    if (context.locale === 'en' && /\borca\b/.test(value) && !/\borca\b/.test(next)) {
      context.commandKeys.add(path)
    } else if (context.locale !== 'en' && context.commandKeys.has(path)) {
      next = rebrandLocalizedCommands(next)
    }
    if (next !== value) {
      context.changes.push([value, next])
    }
    return next
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => rebrandTree(item, context, `${path}[${index}]`))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        rebrandTree(child, context, `${path}.${key}`)
      ])
    )
  }
  return value
}

/**
 * Rebrand one catalog. `commandKeys` carries, from the English pass to the translations, which
 * keys rename the `orca` command; pass the same Set for every locale of a surface, English first.
 */
export function rebrandCatalog(catalog, { locale = 'en', commandKeys = new Set() } = {}) {
  const context = { locale, commandKeys, changes: [] }
  return { catalog: rebrandTree(catalog, context, ''), changes: context.changes }
}

/** Keys that rename the `orca` command, read from a surface's upstream English catalog. */
export function englishCommandKeys(englishCatalog) {
  const commandKeys = new Set()
  rebrandCatalog(englishCatalog, { locale: 'en', commandKeys })
  return commandKeys
}

/** Overlay wins leaf by leaf; objects merge so an overlay only lists what it changes or adds. */
export function mergeCatalogOverlay(base, overlay) {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay === undefined ? base : overlay
  }
  const merged = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = key in base ? mergeCatalogOverlay(base[key], value) : value
  }
  return merged
}

/** The part of `overlay` whose leaves do not exist in `base`: Seal's own keys. */
export function overlayKeysAbsentFrom(base, overlay) {
  if (!isPlainObject(overlay)) {
    return base === undefined ? overlay : undefined
  }
  const absent = {}
  for (const [key, value] of Object.entries(overlay)) {
    const baseChild = isPlainObject(base) ? base[key] : undefined
    const child = isPlainObject(value)
      ? overlayKeysAbsentFrom(baseChild, value)
      : baseChild === undefined
        ? value
        : undefined
    if (child !== undefined && !(isPlainObject(child) && Object.keys(child).length === 0)) {
      absent[key] = child
    }
  }
  return absent
}

/** Leaves of `target` that differ from, or are missing in, `base`. */
export function catalogDifference(base, target) {
  if (!isPlainObject(target)) {
    return JSON.stringify(base) === JSON.stringify(target) ? undefined : target
  }
  const difference = {}
  for (const [key, value] of Object.entries(target)) {
    const child = catalogDifference(isPlainObject(base) ? base[key] : undefined, value)
    if (child !== undefined && !(isPlainObject(child) && Object.keys(child).length === 0)) {
      difference[key] = child
    }
  }
  return difference
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/
export const REMOVED_KEYS_FILE = 'removed-keys.json'

/** Upstream keys Seal's UI no longer names, as dotted paths without plural suffixes. */
export function readRemovedKeys(root, surface) {
  const path = join(root, surface.overlayDir, REMOVED_KEYS_FILE)
  return new Set(existsSync(path) ? readJson(path) : [])
}

/** `catalog` without the removed keys, in every plural form a locale declares. */
export function withoutRemovedKeys(catalog, removedKeys, prefix = '') {
  if (removedKeys.size === 0 || !isPlainObject(catalog)) {
    return catalog
  }
  const kept = {}
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) {
      const child = withoutRemovedKeys(value, removedKeys, path)
      if (Object.keys(child).length > 0) {
        kept[key] = child
      }
    } else if (!removedKeys.has(path.replace(PLURAL_SUFFIX, ''))) {
      kept[key] = value
    }
  }
  return kept
}

export function leafKeyNames(catalog, prefix = '', names = new Set()) {
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) {
      leafKeyNames(value, path, names)
    } else {
      names.add(path.replace(PLURAL_SUFFIX, ''))
    }
  }
  return names
}

/** Keys of upstream's English catalog that the catalog Seal ships no longer has. */
export function removedKeyNames(upstreamEnglish, shippedEnglish) {
  const shipped = leafKeyNames(shippedEnglish)
  return [...leafKeyNames(upstreamEnglish)].filter((name) => !shipped.has(name))
}

export function readOverlay(root, surface, locale) {
  const path = join(root, surface.overlayDir, `${locale}.json`)
  return existsSync(path) ? readJson(path) : {}
}

/** Builds what a surface ships for each of its catalog files, sharing the English command pass. */
export function createSurfaceCatalogBuilder(root, surface) {
  let commandKeys
  const removedKeys = readRemovedKeys(root, surface)
  const englishCommandKeySet = () => {
    commandKeys ??= englishCommandKeys(readJson(join(root, surface.dir, 'en.json')))
    return commandKeys
  }
  return {
    surface,
    /** `upstream` is the parsed catalog (possibly a subset of it) for `locale`. */
    buildLocaleCatalog(upstream, locale) {
      const { catalog } = rebrandCatalog(upstream, { locale, commandKeys: englishCommandKeySet() })
      return mergeCatalogOverlay(
        withoutRemovedKeys(catalog, removedKeys),
        readOverlay(root, surface, locale)
      )
    },
    /** The boot bundle's English entries; the whole English overlay rides along so it always wins. */
    buildRuntimeRequiredCatalog(upstream) {
      const { catalog } = rebrandCatalog(upstream, { locale: 'en', commandKeys: new Set() })
      return mergeCatalogOverlay(
        withoutRemovedKeys(catalog, removedKeys),
        readOverlay(root, surface, 'en')
      )
    }
  }
}

/** Which surface and locale a path names, or null. Paths are repo-relative with `/` separators. */
export function classifyCatalogPath(relativePath) {
  for (const surface of LOCALE_SURFACES) {
    if (relativePath === surface.runtimeRequiredPath) {
      return { surface, kind: 'runtime-required', locale: 'en' }
    }
    if (relativePath.startsWith(`${surface.overlayDir}/`)) {
      return null
    }
    if (
      relativePath.startsWith(`${surface.dir}/`) &&
      relativePath.endsWith('.json') &&
      !relativePath.slice(surface.dir.length + 1).includes('/') &&
      !basename(relativePath).startsWith('.')
    ) {
      return { surface, kind: 'locale', locale: basename(relativePath, '.json') }
    }
  }
  return null
}

/** Upstream English values the rebrand changes, for matching inline source defaults. */
export function readEnglishBrandChanges(root) {
  const changes = new Map()
  for (const surface of LOCALE_SURFACES) {
    for (const path of [join(surface.dir, 'en.json'), surface.runtimeRequiredPath]) {
      const absolute = join(root, path)
      if (!existsSync(absolute)) {
        continue
      }
      for (const [from, to] of rebrandCatalog(readJson(absolute), { locale: 'en' }).changes) {
        changes.set(from, to)
      }
    }
  }
  return changes
}
