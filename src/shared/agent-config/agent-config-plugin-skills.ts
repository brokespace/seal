import { parseJsonObject } from './agent-config-json-edit'
import type { AgentConfigPluginsState, AgentConfigSkillBundle } from './agent-config-types'
import { isPlainObject, stringList } from './agent-config-values'

export type PluginSkillBundle = Extract<AgentConfigSkillBundle, { kind: 'plugin' }>

/** A plugin's folder on the machine and the rules its agent picks skills from it by. */
export type PluginSkillFolder = {
  bundle: PluginSkillBundle
  root: string
  /** Skill folders named outside the plugin's own manifest, relative to `root`. */
  declared: string[]
  /** Whether `<root>/skills` is read as well. */
  defaultDir: boolean
  /** Whether a skill may sit in a grouping folder below a skills folder. */
  nested: boolean
}

const SKILL_FILE = 'SKILL.md'
const MANIFEST_FILE = 'plugin.json'
const MANIFEST_DIRS = ['.claude-plugin', '.codex-plugin', '.cursor-plugin', '']
const DEFAULT_SKILLS_DIR = 'skills'
/** 1.10.0 comes after 1.9.0. */
const VERSION_ORDER = new Intl.Collator(undefined, { numeric: true })

/** File names a plugin's folder is searched for. */
export const PLUGIN_SKILL_FILE_NAMES = [SKILL_FILE, MANIFEST_FILE]

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

function relativeTo(root: string, path: string): string | null {
  const prefix = `${normalize(root)}/`
  const normalized = normalize(path)
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null
}

/** `./skills/pdf/` and `skills/pdf` name the same folder; the plugin's own folder is ''. */
function relativeFolder(declared: string): string {
  return normalize(declared)
    .replace(/^(\.\/)+/, '')
    .replace(/^\.$/, '')
}

function pathList(value: unknown): string[] {
  return typeof value === 'string' ? [value] : stringList(value)
}

function splitPluginId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@')
  return at > 0
    ? { name: id.slice(0, at), marketplace: id.slice(at + 1) }
    : { name: id, marketplace: '' }
}

/**
 * Claude Code's installed plugins. A plugin that is the marketplace repository itself and
 * lists its skills gets those alone; any other gets its `skills` folder plus what it lists.
 */
export function claudePluginSkillFolders(
  state: AgentConfigPluginsState,
  manifests: Record<string, unknown>,
  inProject: boolean
): PluginSkillFolder[] {
  const seen = new Set<string>()
  return state.plugins.flatMap((plugin) => {
    const manifest = manifests[plugin.marketplace]
    const listed =
      isPlainObject(manifest) && Array.isArray(manifest.plugins) ? manifest.plugins : []
    const entry = listed.filter(isPlainObject).find((item) => item.name === plugin.name)
    const declared = pathList(entry?.skills).map(relativeFolder)
    const isMarketplaceRoot =
      typeof entry?.source === 'string' && relativeFolder(entry.source) === ''
    return plugin.installs.flatMap((install): PluginSkillFolder[] => {
      // The machine page is about the account: another project's install is not loaded here.
      if (!install.installPath || (!inProject && install.scope !== 'user')) {
        return []
      }
      if (seen.has(install.installPath)) {
        return []
      }
      seen.add(install.installPath)
      return [
        {
          bundle: {
            kind: 'plugin',
            id: plugin.id,
            name: plugin.name,
            version: install.version,
            enabled: plugin.enabled
          },
          root: install.installPath,
          declared,
          defaultDir: !(isMarketplaceRoot && declared.length > 0),
          nested: false
        }
      ]
    })
  })
}

/** Codex's plugins: `[plugins."name@marketplace"]` in config.toml, unpacked under the cache folder. */
export function codexPluginSkillFolders(
  config: Record<string, unknown> | null,
  cacheDir: string
): PluginSkillFolder[] {
  const plugins = isPlainObject(config?.plugins) ? config.plugins : {}
  const separator = cacheDir.includes('\\') ? '\\' : '/'
  return Object.entries(plugins).flatMap(([id, value]): PluginSkillFolder[] => {
    const { name, marketplace } = splitPluginId(id)
    if (!marketplace || [name, marketplace].some((part) => /[\\/]|^\.\.?$/.test(part))) {
      return []
    }
    return [
      {
        bundle: {
          kind: 'plugin',
          id,
          name,
          version: null,
          enabled: !isPlainObject(value) || value.enabled !== false
        },
        root: [cacheDir, marketplace, name].join(separator),
        declared: [],
        defaultDir: true,
        nested: true
      }
    ]
  })
}

/** Narrows a plugin whose cache keeps one folder per version to the newest one found. */
export function latestPluginVersion<T extends { path: string }>(
  folder: PluginSkillFolder,
  records: readonly T[]
): PluginSkillFolder {
  const versions = records
    .flatMap((record) => relativeTo(folder.root, record.path)?.split('/')[0] ?? [])
    .toSorted(VERSION_ORDER.compare)
  const version = versions.at(-1)
  return version === undefined
    ? folder
    : {
        ...folder,
        bundle: { ...folder.bundle, version },
        root: `${folder.root}${folder.root.includes('\\') ? '\\' : '/'}${version}`
      }
}

/** Cursor unpacks plugins as `<cache>/<marketplace>/<plugin>/<version>` and keeps no registry of them. */
export function cursorPluginSkillFolders<T extends { path: string }>(
  cacheDir: string,
  records: readonly T[]
): PluginSkillFolder[] {
  const separator = cacheDir.includes('\\') ? '\\' : '/'
  const latest = new Map<string, string[]>()
  for (const record of records) {
    const parts = relativeTo(cacheDir, record.path)?.split('/') ?? []
    if (parts.length > 3) {
      const [marketplace, plugin, version] = parts
      const key = `${marketplace}/${plugin}`
      const known = latest.get(key)?.[2]
      if (known === undefined || VERSION_ORDER.compare(known, version) < 0) {
        latest.set(key, [marketplace, plugin, version])
      }
    }
  }
  return [...latest.entries()].map(([id, parts]) => ({
    bundle: { kind: 'plugin', id, name: parts[1], version: null, enabled: null },
    root: [cacheDir, ...parts].join(separator),
    declared: [],
    defaultDir: true,
    nested: false
  }))
}

function manifestOf<T extends { path: string; head: string }>(
  root: string,
  records: readonly T[]
): Record<string, unknown> | null {
  for (const dir of MANIFEST_DIRS) {
    const wanted = dir ? `${dir}/${MANIFEST_FILE}` : MANIFEST_FILE
    const record = records.find((item) => relativeTo(root, item.path) === wanted)
    const parsed = record ? parseJsonObject(record.head) : null
    if (parsed?.ok) {
      return parsed.value
    }
  }
  return null
}

/** The plugin as its own manifest names it, and the `SKILL.md` files its agent loads from it. */
export function pluginSkills<T extends { path: string; head: string }>(
  folder: PluginSkillFolder,
  records: readonly T[]
): { bundle: PluginSkillBundle; skills: T[] } {
  const manifest = manifestOf(folder.root, records)
  const folders = new Set([
    ...folder.declared,
    ...pathList(manifest?.skills).map(relativeFolder),
    ...(folder.defaultDir ? [DEFAULT_SKILLS_DIR] : [])
  ])
  const skills = records.filter((record) => {
    const relative = relativeTo(folder.root, record.path)
    if (relative === null || !(relative === SKILL_FILE || relative.endsWith(`/${SKILL_FILE}`))) {
      return false
    }
    const skillDir = relative.slice(0, -SKILL_FILE.length).replace(/\/$/, '')
    const parent = skillDir.includes('/') ? skillDir.slice(0, skillDir.lastIndexOf('/')) : ''
    return [...folders].some(
      (candidate) =>
        skillDir === candidate ||
        (skillDir !== '' && parent === candidate) ||
        (folder.nested && (candidate === '' || skillDir.startsWith(`${candidate}/`)))
    )
  })
  const version = typeof manifest?.version === 'string' ? manifest.version : null
  return {
    bundle: {
      ...folder.bundle,
      // Cursor's cache folders are numbered; the manifest holds the name people know.
      ...(folder.bundle.enabled === null && typeof manifest?.name === 'string'
        ? { name: manifest.name }
        : {}),
      version: folder.bundle.version ?? version
    },
    skills
  }
}
