import { ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  LayoutDashboard,
  Radio,
  Server,
  Sparkles,
  UserRound,
  type LucideIcon
} from 'lucide-react-native'
import { LIST_LEADING_INSET, ListGroup, ListRow } from '../../components/list/ListGroup'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useRouteHandoff } from '../../navigation/route-handoff'
import { colors, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { useLiveSessionsFeed } from '../live-sessions/live-sessions-feed'
import { liveSessionNeedsAttention } from '../live-sessions/live-session-presentation'
import { sealPageHref, type SealPage } from '../seal-route-hrefs'
import { SealScreenFrame } from '../SealScreenFrame'

type HubEntry = { page: SealPage; icon: LucideIcon; title: string; subtitle: string }

/** A host's Seal features, one large row each. */
export function SealHubScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const { client } = useHostClient(hostId)
  const live = useLiveSessionsFeed(client)
  const waiting = live.sessions.filter(liveSessionNeedsAttention).length

  const entries: HubEntry[] = [
    {
      page: 'overview',
      icon: LayoutDashboard,
      title: t('seal.hub.overview', 'Overview'),
      subtitle: t('seal.hub.overviewHint', 'What needs you, sessions, machines and usage')
    },
    {
      page: 'sessions',
      icon: Radio,
      title: t('seal.hub.sessions', 'Live sessions'),
      subtitle:
        waiting > 0
          ? t('seal.hub.sessionsWaiting', '{{value0}} waiting on you', { value0: waiting })
          : t('seal.hub.sessionsHint', 'Every agent session, including ones outside Seal')
    },
    {
      page: 'machines',
      icon: Server,
      title: t('seal.hub.machines', 'Machines'),
      subtitle: t('seal.hub.machinesHint', 'Status, metrics and files')
    },
    {
      page: 'accounts',
      icon: UserRound,
      title: t('seal.hub.accounts', 'Accounts'),
      subtitle: t('seal.hub.accountsHint', 'Usage, auto-swap and switching')
    },
    {
      page: 'chat',
      icon: Sparkles,
      title: t('seal.hub.assistant', 'Assistant'),
      subtitle: t('seal.hub.assistantHint', 'Ask about your sessions and machines')
    }
  ]

  return (
    <SealScreenFrame hostId={hostId} title={t('seal.hub.title', 'Seal')}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.xl
        }}
      >
        <ListGroup separatorInset={LIST_LEADING_INSET}>
          {entries.map(({ page, icon: Icon, title, subtitle }) => (
            <ListRow
              key={page}
              title={title}
              subtitle={subtitle}
              leading={<Icon size={20} color={colors.textSecondary} />}
              navigates
              onPress={() => router.push(sealPageHref(hostId, page))}
            />
          ))}
        </ListGroup>
      </ScrollView>
    </SealScreenFrame>
  )
}
