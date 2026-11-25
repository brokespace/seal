import { useState } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'
import type { SkillEntry } from '../../../../../../shared/seal-connectors/seal-connectors-types'
import { SettingsGroup } from '../../section-layout/SettingsGroup'
import { AppliesToChip } from '../applies-to/AppliesToChip'
import { AppliesToEditor } from '../applies-to/AppliesToEditor'
import { useAppliesToOptions, type AppliesToOptions } from '../applies-to/use-applies-to-options'
import { ConnectorSourceBadge, pluginNameOf } from '../ConnectorSourceBadge'
import { useSealConnectors, type SealConnectors } from '../use-seal-connectors'

function SkillRow({
  skill,
  connectors,
  options
}: {
  skill: SkillEntry
  connectors: SealConnectors
  options: AppliesToOptions
}): React.JSX.Element {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const update = (patch: Partial<SkillEntry>): void =>
    void connectors.editConfig((config) => ({
      ...config,
      skills: config.skills.map((entry) => (entry.id === skill.id ? { ...entry, ...patch } : entry))
    }))
  return (
    <div data-settings-row="" data-seal-skill={skill.id} className="space-y-2 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{skill.name}</p>
          {skill.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <ConnectorSourceBadge source={skill.source} />
            <AppliesToChip value={skill} options={options} />
            {skill.source.kind === 'plugin' ? (
              <span className="text-xs text-muted-foreground">
                {t('seal.skills.comesWith', 'Comes with {{plugin}}', {
                  plugin: pluginNameOf(skill.source.pluginId)
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('seal.skills.appliesTo', 'Choose where {{name}} applies', {
              name: skill.name
            })}
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            <Settings2 />
          </Button>
          <Switch
            checked={skill.enabled}
            aria-label={t('seal.skills.enabled', 'Use {{name}}', { name: skill.name })}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
      </div>
      {editing ? (
        <div className="rounded-md border border-border p-3">
          <AppliesToEditor value={skill} options={options} onChange={(next) => update(next)} />
        </div>
      ) : null}
    </div>
  )
}

export function SealSkillsPaneView({
  connectors
}: {
  connectors: SealConnectors
}): React.JSX.Element {
  const t = useTranslate()
  const options = useAppliesToOptions(connectors.fleet)
  const skills = connectors.config?.skills ?? []
  return (
    <SettingsGroup
      title={t('seal.skills.title', 'Skills')}
      description={t(
        'seal.skills.description',
        'Skills every agent session gets, from plugins and from the Seal library.'
      )}
    >
      {!connectors.config ? (
        <div data-settings-row="" className="flex h-16 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : skills.length === 0 ? (
        <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
          {t('seal.skills.none', 'No skills yet. Install a plugin that brings some.')}
        </p>
      ) : (
        skills.map((skill) => (
          <SkillRow key={skill.id} skill={skill} connectors={connectors} options={options} />
        ))
      )}
    </SettingsGroup>
  )
}

export function SealSkillsPane(): React.JSX.Element {
  const t = useTranslate()
  const connectors = useSealConnectors(t('seal.connectors.error', 'Could not update connectors'))
  return <SealSkillsPaneView connectors={connectors} />
}
