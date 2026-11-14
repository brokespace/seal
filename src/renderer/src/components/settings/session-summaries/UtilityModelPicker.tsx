import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { UtilityModelCatalogEntry } from '../../../../../shared/utility-model/utility-model-types'
import {
  SettingsSearchableSelect,
  type SettingsSearchableSelectGroup,
  type SettingsSearchableSelectOption
} from '../form-controls/SettingsSearchableSelect'

// cmdk derives a value from the label when given an empty one.
const AUTOMATIC = '__automatic__'

/** One model of a provider: its own list, searchable, plus any id typed by hand. Null is the provider's default. */
export function UtilityModelPicker({
  ariaLabel,
  value,
  automaticLabel,
  entries,
  unavailable,
  loading,
  disabled,
  onOpen,
  onChange
}: {
  ariaLabel: string
  value: string | null
  automaticLabel: string
  entries: readonly UtilityModelCatalogEntry[]
  unavailable: ReadonlySet<string>
  loading: boolean
  disabled: boolean
  /** The provider's list is fetched the first time a picker opens. */
  onOpen: () => void
  onChange: (model: string | null) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const typed = query.trim()
  const known = new Set(entries.map((entry) => entry.id))
  const option = (entry: UtilityModelCatalogEntry): SettingsSearchableSelectOption => ({
    value: entry.id,
    label: entry.id,
    keywords: entry.description ? [entry.description] : undefined,
    detail: unavailable.has(entry.id)
      ? t('seal.cloudflareAi.model.notOnPlan', 'paid plan')
      : entry.free
        ? t('seal.summaryModels.model.free', 'free')
        : undefined
  })
  const free = entries.filter((entry) => entry.free)
  const rest = entries.filter((entry) => !entry.free)
  const groups: SettingsSearchableSelectGroup[] = [
    {
      key: 'automatic',
      options: [
        { value: AUTOMATIC, label: automaticLabel },
        // A hand-typed id stays selectable though the provider's list does not name it.
        ...(value !== null && !known.has(value) ? [{ value, label: value }] : [])
      ]
    },
    {
      key: 'free',
      heading: t('seal.summaryModels.model.freeHeading', 'Free'),
      options: free.map(option)
    },
    {
      key: 'models',
      heading: free.length > 0 ? t('seal.summaryModels.model.paidHeading', 'Paid') : undefined,
      options: rest.map(option)
    }
  ]
  return (
    <SettingsSearchableSelect
      ariaLabel={ariaLabel}
      value={value ?? AUTOMATIC}
      groups={groups}
      disabled={disabled}
      onValueChange={(next) => onChange(next === AUTOMATIC ? null : next)}
      onOpenChange={(open) => open && onOpen()}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={t('seal.summaryModels.model.search', 'Search models or type a model id')}
      status={
        loading ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t('seal.summaryModels.model.loading', 'Loading the provider’s models…')}
          </div>
        ) : undefined
      }
      actions={
        typed && !known.has(typed) && typed !== value && !/\s/.test(typed)
          ? [
              {
                key: 'typed',
                label: t('seal.summaryModels.model.useTyped', 'Use “{{model}}”', { model: typed }),
                onSelect: () => onChange(typed)
              }
            ]
          : undefined
      }
    />
  )
}
