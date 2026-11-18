import { Bot } from 'lucide-react-native'
import { ScrollView, Text, View } from 'react-native'
import { SectionHeader } from '../../components/list/ListGroup'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useResponsiveLayout } from '../../layout/responsive-layout'
import type { HostProfile } from '../../host-catalog/host-profile'
import { useHostDisplay } from '../../host-descriptors/use-host-display'
import {
  LiveSessionsHostList,
  useLiveSessionsHost
} from '../../seal/live-sessions/LiveSessionsHostList'
import { colors, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { MobileHomeData } from '../use-mobile-home-data'
import { MobileHomeTabHeader } from './MobileHomeTabHeader'

/**
 * Every agent session on every paired desktop, as its sidebar lists them: the live-session registry,
 * which holds external CLI sessions and other machines' sessions as well as Seal's own panes.
 */
export function MobileHomeAgentsTab(props: { data: MobileHomeData; bottomInset: number }) {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const hosts = props.data.sortedHosts
  return (
    <>
      <MobileHomeTabHeader title={t('home.tabs.agents', 'Agents')} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: props.bottomInset },
          isWideLayout && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
        ]}
      >
        {!props.data.hostCatalogLoaded ? null : hosts.length === 0 ? (
          <View style={styles.empty}>
            <Bot size={30} strokeWidth={1.6} color={colors.textMuted} />
            <Text style={styles.emptyTitle} accessibilityRole="header">
              {t('agents.list.emptyTitle', 'No agents running')}
            </Text>
            <Text style={styles.emptyBody}>
              {t('agents.list.pairDesktop', 'Pair a desktop to see its agents here.')}
            </Text>
          </View>
        ) : (
          hosts.map((host, index) => (
            <AgentsTabDesktop
              key={host.id}
              host={host}
              named={hosts.length > 1}
              first={index === 0}
            />
          ))
        )}
      </ScrollView>
    </>
  )
}

function AgentsTabDesktop(props: { host: HostProfile; named: boolean; first: boolean }) {
  const live = useLiveSessionsHost(props.host.id)
  const title = useHostDisplay(props.host).title
  return (
    <View testID="agents-tab-desktop">
      {props.named ? <SectionHeader title={title} first={props.first} /> : null}
      <LiveSessionsHostList
        hostId={props.host.id}
        host={live}
        first={props.first && !props.named}
      />
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  content: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  empty: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 28,
    marginTop: 32,
    gap: spacing.sm
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  emptyBody: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, textAlign: 'center' }
}))
