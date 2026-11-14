import type { AgentConfigEffectiveEntry, AgentConfigScope } from './agent-config-types'
import { isPlainObject } from './agent-config-values'

export type EffectiveLayer = { scope: AgentConfigScope; value: Record<string, unknown> | null }

const SCOPE_ORDER: readonly AgentConfigScope[] = ['user', 'project', 'local']

function leaves(value: Record<string, unknown>, prefix: string, out: Map<string, unknown>): void {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(item) && Object.keys(item).length > 0) {
      leaves(item, path, out)
    } else {
      out.set(path, item)
    }
  }
}

/**
 * What the agent ends up with once every scope is applied, and which file each value came from.
 * A stronger scope replaces a value; lists add up when the agent merges them (Claude Code's
 * permissions and hooks) and are replaced when it does not (Codex).
 */
export function effectiveConfig(
  layers: readonly EffectiveLayer[],
  options: { mergeLists: boolean }
): AgentConfigEffectiveEntry[] {
  const byKey = new Map<string, { source: AgentConfigScope; value: unknown }[]>()
  for (const scope of SCOPE_ORDER) {
    const layer = layers.find((candidate) => candidate.scope === scope)
    if (!layer?.value) {
      continue
    }
    const flat = new Map<string, unknown>()
    leaves(layer.value, '', flat)
    for (const [key, value] of flat) {
      byKey.set(key, [...(byKey.get(key) ?? []), { source: scope, value }])
    }
  }
  return [...byKey.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, definitions]): AgentConfigEffectiveEntry => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a key is only listed once a scope defines it.
      const winner = definitions.at(-1) as { source: AgentConfigScope; value: unknown }
      if (
        options.mergeLists &&
        definitions.every((definition) => Array.isArray(definition.value))
      ) {
        const seen = new Set<string>()
        const items = definitions.flatMap((definition) =>
          (Array.isArray(definition.value) ? definition.value : []).flatMap((item: unknown) => {
            const text = JSON.stringify(item)
            if (seen.has(text)) {
              return []
            }
            seen.add(text)
            return [{ value: text, source: definition.source }]
          })
        )
        return {
          key,
          value: `[${items.map((item) => item.value).join(',')}]`,
          source: winner.source,
          items,
          overrides: []
        }
      }
      return {
        key,
        value: JSON.stringify(winner.value) ?? 'null',
        source: winner.source,
        overrides: definitions.slice(0, -1).map((definition) => ({
          source: definition.source,
          value: JSON.stringify(definition.value) ?? 'null'
        }))
      }
    })
}
