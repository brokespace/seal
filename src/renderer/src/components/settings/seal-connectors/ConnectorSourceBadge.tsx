import { SettingsBadge } from '../form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import type {
  ConnectorSource,
  SkillEntry
} from '../../../../../shared/seal-connectors/seal-connectors-types'

/** `name@marketplace` shown as its name. */
export function pluginNameOf(pluginId: string): string {
  const at = pluginId.lastIndexOf('@')
  return at > 0 ? pluginId.slice(0, at) : pluginId
}

type Source = ConnectorSource | SkillEntry['source']

/** Where an item came from: Catalog, Plugin <name>, Custom, Imported or Library. */
export function ConnectorSourceBadge({ source }: { source: Source }): React.JSX.Element {
  const t = useTranslate()
  const text =
    source.kind === 'catalog'
      ? t('seal.connectors.source.catalog', 'Catalog')
      : source.kind === 'plugin'
        ? t('seal.connectors.source.plugin', 'Plugin {{name}}', {
            name: pluginNameOf(source.pluginId)
          })
        : source.kind === 'custom'
          ? t('seal.connectors.source.custom', 'Custom')
          : source.kind === 'imported'
            ? t('seal.connectors.source.imported', 'Imported')
            : t('seal.connectors.source.library', 'Library')
  return (
    <SettingsBadge tone="muted" className="max-w-48">
      <span className="truncate" data-connector-source={source.kind}>
        {text}
      </span>
    </SettingsBadge>
  )
}
