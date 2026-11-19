import type {
  Connector,
  PluginEntry,
  SealConnectorsConfig,
  SignInRef,
  SkillEntry
} from './seal-connectors-types'

// Every machine edits its own copy (seeding runs on each host), so copies merge item by item:
// the later edit of an item wins and a removal is remembered so a stale copy cannot revive it.

type Stamped = { id: string; updatedAt?: number }
type Kind = 'connector' | 'plugin' | 'skill' | 'signin'

const stampOf = (item: Stamped): number => item.updatedAt ?? 0

function withoutStamps(item: unknown): string {
  return JSON.stringify(item, (key, value: unknown) => (key === 'updatedAt' ? undefined : value))
}

function removedAt(config: SealConnectorsConfig, kind: Kind, id: string): number {
  return config.removed?.[`${kind}:${id}`] ?? -1
}

function newerItem<T extends Stamped>(a: T, b: T): T {
  if (stampOf(a) !== stampOf(b)) {
    return stampOf(a) > stampOf(b) ? a : b
  }
  // Same stamp, different content (two hosts in the same millisecond): any fixed choice converges.
  return withoutStamps(a) >= withoutStamps(b) ? a : b
}

function mergeItems<T extends Stamped>(
  ours: readonly T[],
  theirs: readonly T[],
  alive: (item: T) => boolean,
  combine: (winner: T, ours: T | undefined, theirs: T | undefined) => T = (winner) => winner
): T[] {
  const theirsById = new Map(theirs.map((item) => [item.id, item]))
  const ourIds = new Set(ours.map((item) => item.id))
  const merged = [
    ...ours.map((item) => {
      const other = theirsById.get(item.id)
      return combine(other ? newerItem(item, other) : item, item, other)
    }),
    ...theirs.filter((item) => !ourIds.has(item.id)).map((item) => combine(item, undefined, item))
  ]
  return merged.filter(alive)
}

function mergeRemoved(
  a: SealConnectorsConfig['removed'],
  b: SealConnectorsConfig['removed']
): Record<string, number> {
  const removed: Record<string, number> = { ...a }
  for (const [key, at] of Object.entries(b ?? {})) {
    removed[key] = Math.max(removed[key] ?? -1, at)
  }
  return removed
}

/** Both copies combined; commutative, so every machine converges on the same list. */
export function mergeSealConnectorsConfigs(
  ours: SealConnectorsConfig,
  theirs: SealConnectorsConfig
): SealConnectorsConfig {
  const removed = mergeRemoved(ours.removed, theirs.removed)
  const probe: SealConnectorsConfig = { ...ours, removed }
  const alive =
    (kind: Kind) =>
    (item: Stamped): boolean =>
      removedAt(probe, kind, item.id) < stampOf(item)
  const connectors = mergeItems<Connector>(
    ours.connectors,
    theirs.connectors,
    alive('connector'),
    (winner, own, other) => ({
      ...winner,
      signIns: mergeItems<SignInRef>(own?.signIns ?? [], other?.signIns ?? [], alive('signin'))
    })
  )
  const refresher =
    (theirs.refresher.updatedAt ?? 0) > (ours.refresher.updatedAt ?? 0)
      ? theirs.refresher
      : ours.refresher
  return {
    ...ours,
    updatedAt: Math.max(ours.updatedAt, theirs.updatedAt),
    connectors,
    plugins: mergeItems<PluginEntry>(ours.plugins, theirs.plugins, alive('plugin')),
    skills: mergeItems<SkillEntry>(ours.skills, theirs.skills, alive('skill')),
    refresher,
    importedHosts: [...new Set([...ours.importedHosts, ...theirs.importedHosts])].sort(),
    removed
  }
}

function stampList<T extends Stamped>(
  before: readonly T[],
  after: readonly T[],
  now: number,
  kind: Kind,
  removed: Record<string, number>,
  inner: (item: T, previous: T | undefined) => T = (item) => item
): T[] {
  const previous = new Map(before.map((item) => [item.id, item]))
  const kept = new Set(after.map((item) => item.id))
  for (const item of before) {
    if (!kept.has(item.id)) {
      removed[`${kind}:${item.id}`] = now
    }
  }
  return after.map((raw) => {
    const prior = previous.get(raw.id)
    const item = inner(raw, prior)
    if (prior && withoutStamps(item) === withoutStamps(prior)) {
      return { ...item, updatedAt: prior.updatedAt }
    }
    return { ...item, updatedAt: now }
  })
}

/** Dates every item an edit changed and remembers every one it removed. */
export function stampSealConnectorsEdit(
  before: SealConnectorsConfig,
  after: SealConnectorsConfig,
  now: number
): SealConnectorsConfig {
  const removed: Record<string, number> = { ...before.removed, ...after.removed }
  const connectors = stampList(
    before.connectors,
    after.connectors,
    now,
    'connector',
    removed,
    (connector, prior) => ({
      ...connector,
      signIns: stampList(prior?.signIns ?? [], connector.signIns, now, 'signin', removed)
    })
  )
  for (const connector of before.connectors) {
    if (!after.connectors.some((entry) => entry.id === connector.id)) {
      for (const signIn of connector.signIns) {
        removed[`signin:${signIn.id}`] = now
      }
    }
  }
  const refresherChanged = withoutStamps(before.refresher) !== withoutStamps(after.refresher)
  return {
    ...after,
    connectors,
    plugins: stampList(before.plugins, after.plugins, now, 'plugin', removed),
    skills: stampList(before.skills, after.skills, now, 'skill', removed),
    refresher: refresherChanged ? { ...after.refresher, updatedAt: now } : after.refresher,
    removed
  }
}

/** Order-free form, for telling whether two copies already agree. */
export function sealConnectorsConfigKey(config: SealConnectorsConfig): string {
  const byId = <T extends Stamped>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify({
    ...config,
    updatedAt: 0,
    connectors: byId(config.connectors).map((connector) => ({
      ...connector,
      signIns: byId(connector.signIns)
    })),
    plugins: byId(config.plugins),
    skills: byId(config.skills),
    removed: Object.fromEntries(Object.entries(config.removed ?? {}).sort())
  })
}

/** Whether a sign-in was explicitly removed (its secret may then be deleted everywhere). */
export function signInRemoved(config: SealConnectorsConfig, id: string): boolean {
  return removedAt(config, 'signin', id) >= 0
}
