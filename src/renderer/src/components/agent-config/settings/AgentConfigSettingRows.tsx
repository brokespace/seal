import React from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { UNSET } from './agent-config-settings-form'

/** A settings row whose control needs the full width: lists and name/value tables. */
export function AgentConfigStackedRow({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div data-settings-row="" className="space-y-2 py-3">
      <div className="space-y-1">
        <Label className="select-text">{label}</Label>
        {description ? (
          <p className="select-text text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/** A choice among the values an agent accepts, plus "not set in this file". */
export function AgentConfigChoice({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  // A value Seal does not know stays selectable, so opening the list never rewrites it.
  const all = value === '' || options.includes(value) ? options : [value, ...options]
  return (
    <Select
      value={value === '' ? UNSET : value}
      onValueChange={(next) => onChange(next === UNSET ? '' : next)}
    >
      <SelectTrigger className="w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>
          {t('auto.components.agentConfig.settings.unset', 'Not set')}
        </SelectItem>
        {all.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
