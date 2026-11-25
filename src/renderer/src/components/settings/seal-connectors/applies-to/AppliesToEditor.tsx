import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTranslate } from '@/i18n/use-translate'
import type {
  AppliesTo,
  ProjectOverride,
  SealScope
} from '../../../../../../shared/seal-connectors/seal-connectors-types'
import { ProjectOverridesEditor } from './ProjectOverridesEditor'
import type { AppliesToOption, AppliesToOptions } from './use-applies-to-options'

export type AppliesToValue = {
  appliesTo: AppliesTo
  projectOverrides: ProjectOverride[]
}

/** Saved scopes can name machines or accounts Seal no longer lists; keep them visible so they can be unchecked. */
function withSaved(options: readonly AppliesToOption[], scope: SealScope): AppliesToOption[] {
  if (scope === 'all') {
    return [...options]
  }
  const known = new Set(options.map((option) => option.id))
  return [...options, ...scope.filter((id) => !known.has(id)).map((id) => ({ id, label: id }))]
}

function Checklist({
  title,
  scope,
  options,
  noun,
  onChange
}: {
  title: string
  scope: SealScope
  options: readonly AppliesToOption[]
  noun: string
  onChange: (scope: SealScope) => void
}): React.JSX.Element {
  const t = useTranslate()
  const id = useId()
  const all = withSaved(options, scope)
  const checked = (option: string): boolean => scope === 'all' || scope.includes(option)
  const toggle = (option: string, on: boolean): void => {
    const current = scope === 'all' ? all.map((item) => item.id) : scope
    onChange(on ? [...current, option] : current.filter((item) => item !== option))
  }
  const summary =
    scope === 'all'
      ? t('seal.connectors.appliesTo.allOf', 'All {{noun}}', { noun })
      : scope.length === 0
        ? t('seal.connectors.appliesTo.none', 'None')
        : t('seal.connectors.appliesTo.someOf', '{{count}} of {{total}}', {
            count: scope.length,
            total: all.length
          })
  return (
    <div
      data-applies-to-dimension={title}
      className="flex items-center justify-between gap-3 py-1.5"
    >
      <span className="text-sm">{title}</span>
      <div className="flex items-center gap-2">
        <span
          className={
            scope !== 'all' && scope.length === 0
              ? 'text-xs text-status-warning-text'
              : 'text-xs text-muted-foreground'
          }
        >
          {summary}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="xs" aria-label={title}>
              {t('seal.connectors.appliesTo.choose', 'Choose')}
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <fieldset className="space-y-2">
              <legend className="sr-only">{title}</legend>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-all`}
                  checked={scope === 'all' ? true : scope.length > 0 ? 'indeterminate' : false}
                  onCheckedChange={(on) => onChange(on === true ? 'all' : [])}
                />
                <Label htmlFor={`${id}-all`}>
                  {t('seal.connectors.appliesTo.allLater', 'All, including ones added later')}
                </Label>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto scrollbar-sleek">
                {all.map((option, index) => (
                  <div key={option.id} className="flex items-center gap-2 pl-6">
                    <Checkbox
                      id={`${id}-${index}`}
                      checked={checked(option.id)}
                      onCheckedChange={(on) => toggle(option.id, on === true)}
                    />
                    <Label htmlFor={`${id}-${index}`} className="min-w-0">
                      <span className="truncate">{option.label}</span>
                    </Label>
                  </div>
                ))}
                {all.length === 0 ? (
                  <p className="pl-6 text-xs text-muted-foreground">
                    {t('seal.connectors.appliesTo.noneListed', 'Nothing to choose from yet.')}
                  </p>
                ) : null}
              </div>
            </fieldset>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

/** Machines, accounts and agents an item reaches (each All unless narrowed), plus per-project overrides. */
export function AppliesToEditor({
  value,
  options,
  onChange,
  showProjectOverrides = true
}: {
  value: AppliesToValue
  options: AppliesToOptions
  onChange: (value: AppliesToValue) => void
  showProjectOverrides?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const { appliesTo, projectOverrides } = value
  const change = (patch: Partial<AppliesTo>): void =>
    onChange({ appliesTo: { ...appliesTo, ...patch }, projectOverrides })
  return (
    <div className="space-y-3" data-applies-to-editor="">
      <div className="divide-y divide-border">
        <Checklist
          title={t('seal.connectors.appliesTo.machines', 'Machines')}
          noun={t('seal.connectors.appliesTo.machinesNoun', 'machines')}
          scope={appliesTo.machines}
          options={options.machines}
          onChange={(machines) => change({ machines })}
        />
        <Checklist
          title={t('seal.connectors.appliesTo.accounts', 'Accounts')}
          noun={t('seal.connectors.appliesTo.accountsNoun', 'accounts')}
          scope={appliesTo.accounts}
          options={options.accounts}
          onChange={(accounts) => change({ accounts })}
        />
        <Checklist
          title={t('seal.connectors.appliesTo.harnesses', 'Agents')}
          noun={t('seal.connectors.appliesTo.harnessesNoun', 'agents')}
          scope={appliesTo.harnesses}
          options={options.harnesses}
          onChange={(harnesses) => change({ harnesses })}
        />
      </div>
      {showProjectOverrides ? (
        <ProjectOverridesEditor
          overrides={projectOverrides}
          machines={options.machines}
          onChange={(next) => onChange({ appliesTo, projectOverrides: next })}
        />
      ) : null}
    </div>
  )
}
