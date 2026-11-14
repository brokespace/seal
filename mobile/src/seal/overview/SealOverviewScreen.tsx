import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQueryClient } from '@tanstack/react-query'
import { LIST_LEADING_INSET, ListGroup, SectionHeader } from '../../components/list/ListGroup'
import { MobileOfflineState } from '../../components/MobileStateView'
import { useNow } from '../../hooks/use-now'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useRouteHandoff } from '../../navigation/route-handoff'
import { useHostQuery } from '../../query/host-query'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { orderedSealCandidates, sealProviderLabel } from '../accounts/seal-account-presentation'
import { SealAccountUsageCard } from '../accounts/SealAccountUsageCard'
import { useSealAccounts } from '../accounts/use-seal-accounts'
import { liveSessionsNeedingAttention } from '../../../../src/shared/live-sessions/live-session-summary'
import { liveSessionFinished } from '../live-sessions/live-session-presentation'
import type { LiveSession } from '../live-sessions/live-session-schemas'
import { LiveSessionGroups, LiveSessionRow } from '../live-sessions/LiveSessionRow'
import { useLiveSessionsFeed } from '../live-sessions/live-sessions-feed'
import { sealPageHref, sealSessionHref } from '../seal-route-hrefs'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import { SealOverviewMachineRow } from './SealOverviewMachineRow'
import {
  SEAL_OVERVIEW_NO_INPUT,
  SEAL_OVERVIEW_TARGET,
  sealOverviewMachinesQuery,
  sealOverviewMetricsQuery
} from './seal-overview-machines'

/** Desktop Home on a phone: what needs you, sessions by machine and project, machines, and account usage. */
export function SealOverviewScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const connected = state === 'connected'
  const feed = useLiveSessionsFeed(client)
  const machines = useHostQuery(
    sealOverviewMachinesQuery,
    { hostId, client },
    SEAL_OVERVIEW_TARGET,
    SEAL_OVERVIEW_NO_INPUT
  )
  const accounts = useSealAccounts(hostId, client, true)
  const now = useNow(60_000, true)
  const [pulling, setPulling] = useState(false)

  const open = (session: LiveSession) => router.push(sealSessionHref(hostId, session.id))
  const running = feed.sessions.filter((session) => !liveSessionFinished(session))
  const attention = liveSessionsNeedingAttention(running)
  const providers = Object.entries(accounts.status?.providers ?? {}).filter(
    ([, provider]) => provider.candidates.length > 0
  )

  const refresh = async () => {
    setPulling(true)
    try {
      await Promise.all([
        feed.refresh(),
        machines.refetch(),
        queryClient.invalidateQueries({
          queryKey: ['orca', hostId, sealOverviewMetricsQuery.family]
        }),
        accounts.refreshUsage()
      ])
    } finally {
      setPulling(false)
    }
  }

  const nothingLoaded = !feed.loaded && !machines.data && !accounts.status
  if (nothingLoaded && !connected) {
    return (
      <SealScreenFrame hostId={hostId} title={t('seal.overview.title', 'Overview')}>
        <MobileOfflineState hostName={hostName} />
      </SealScreenFrame>
    )
  }

  return (
    <SealScreenFrame
      hostId={hostId}
      title={t('seal.overview.title', 'Overview')}
      refreshing={nothingLoaded}
    >
      <ScrollView
        contentContainerStyle={[sealStyles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={pulling && connected}
            tintColor={colors.textSecondary}
            onRefresh={() => void refresh()}
          />
        }
      >
        {attention.length > 0 ? (
          <>
            <SectionHeader
              title={t('seal.overview.attention', 'Needs you')}
              trailing={String(attention.length)}
              first
            />
            <ListGroup separatorInset={LIST_LEADING_INSET} style={sealStyles.group}>
              {attention.map((session) => (
                <LiveSessionRow key={session.id} session={session} onPress={open} />
              ))}
            </ListGroup>
          </>
        ) : null}

        <SectionHeader
          title={t('seal.overview.sessions', 'Sessions')}
          trailing={feed.loaded ? String(running.length) : undefined}
          first={attention.length === 0}
        />
        {feed.error ? (
          <Text style={[sealStyles.hint, sealStyles.errorText]}>{feed.error}</Text>
        ) : !feed.loaded ? (
          <Text style={sealStyles.hint}>{t('seal.overview.loading', 'Loading…')}</Text>
        ) : running.length === 0 ? (
          <Text style={sealStyles.hint}>
            {t('seal.overview.noSessions', 'No agents running right now.')}
          </Text>
        ) : (
          <LiveSessionGroups sessions={running} onOpen={open} />
        )}

        <SectionHeader title={t('seal.overview.machines', 'Machines')} />
        {machines.data && machines.data.length > 0 ? (
          <ListGroup separatorInset={LIST_LEADING_INSET} style={sealStyles.group}>
            {machines.data.map((machine) => (
              <SealOverviewMachineRow
                key={machine.id}
                hostId={hostId}
                client={client}
                machine={machine}
                onPress={() => router.push(sealPageHref(hostId, 'machines'))}
              />
            ))}
          </ListGroup>
        ) : (
          <Text style={[sealStyles.hint, machines.error ? sealStyles.errorText : null]}>
            {machines.error
              ? machines.error.message
              : machines.data
                ? t('seal.overview.noMachines', 'No machines yet.')
                : t('seal.overview.loading', 'Loading…')}
          </Text>
        )}

        <SectionHeader title={t('seal.overview.accounts', 'Accounts')} />
        {accounts.status ? (
          providers.length === 0 ? (
            <Text style={sealStyles.hint}>
              {t('seal.overview.noAccounts', 'No accounts set up for auto-swap.')}
            </Text>
          ) : (
            <>
              {providers.map(([provider, entry]) => (
                <View key={provider}>
                  <Text style={sealStyles.groupLabel}>{sealProviderLabel(provider)}</Text>
                  {orderedSealCandidates(entry.candidates).map((candidate) => (
                    <SealAccountUsageCard
                      key={candidate.key}
                      candidate={candidate}
                      now={now}
                      compact
                    />
                  ))}
                </View>
              ))}
              <Pressable
                style={({ pressed }) => [sealStyles.textButton, pressed && pressedStyle]}
                onPress={() => router.push(sealPageHref(hostId, 'accounts'))}
                accessibilityRole="button"
              >
                <Text style={sealStyles.textButtonLabel}>
                  {t('seal.overview.manageAccounts', 'Manage accounts')}
                </Text>
              </Pressable>
            </>
          )
        ) : (
          <Text style={[sealStyles.hint, accounts.loadError ? sealStyles.errorText : null]}>
            {accounts.loadError?.message ?? t('seal.overview.loading', 'Loading…')}
          </Text>
        )}
      </ScrollView>
    </SealScreenFrame>
  )
}
