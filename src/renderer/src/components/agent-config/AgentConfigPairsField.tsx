import React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

/** `id` is the row's identity while its name is being typed. */
export type AgentConfigPair = { id: string; key: string; value: string }

let nextPairId = 0

function newPair(key: string, value: string): AgentConfigPair {
  nextPairId += 1
  return { id: `pair-${nextPairId}`, key, value }
}

export function pairsFromRecord(record: Record<string, string>): AgentConfigPair[] {
  return Object.entries(record).map(([key, value]) => newPair(key, value))
}

export function recordFromPairs(pairs: readonly AgentConfigPair[]): Record<string, string> {
  return Object.fromEntries(
    pairs.filter((pair) => pair.key.trim() !== '').map((pair) => [pair.key.trim(), pair.value])
  )
}

/** Name and value rows for environment variables and HTTP headers. */
export function AgentConfigPairsField({
  label,
  pairs,
  keyPlaceholder,
  valuePlaceholder,
  onChange
}: {
  label: string
  pairs: readonly AgentConfigPair[]
  keyPlaceholder: string
  valuePlaceholder: string
  onChange: (pairs: AgentConfigPair[]) => void
}): React.JSX.Element {
  const t = useTranslate()
  const patch = (id: string, change: Partial<AgentConfigPair>): void =>
    onChange(pairs.map((pair) => (pair.id === id ? { ...pair, ...change } : pair)))
  return (
    <div className="space-y-2">
      {pairs.map((pair) => (
        <div key={pair.id} className="flex items-center gap-2">
          <Input
            value={pair.key}
            variant="code"
            className="h-7 w-2/5"
            placeholder={keyPlaceholder}
            aria-label={`${label}: ${keyPlaceholder}`}
            onChange={(event) => patch(pair.id, { key: event.target.value })}
          />
          <Input
            value={pair.value}
            variant="code"
            className="h-7 min-w-0 flex-1"
            placeholder={valuePlaceholder}
            aria-label={`${label}: ${valuePlaceholder}`}
            onChange={(event) => patch(pair.id, { value: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.agentConfig.pairs.remove', 'Remove {{name}}', {
              name: pair.key || label
            })}
            onClick={() => onChange(pairs.filter((other) => other.id !== pair.id))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="-ml-1.5"
        onClick={() => onChange([...pairs, newPair('', '')])}
      >
        <Plus />
        {t('auto.components.agentConfig.pairs.add', 'Add')}
      </Button>
    </div>
  )
}
