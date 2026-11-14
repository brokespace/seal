import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { UserRound } from 'lucide-react-native'
import {
  SEAL_PROVIDERS,
  type SealProvider
} from '../../../../src/shared/seal-accounts/seal-accounts-config'
import { ConfirmModal } from '../../components/ConfirmModal'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { MobileSwitch } from '../../components/MobileSwitch'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useNow } from '../../hooks/use-now'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import {
  canUseSealCandidate,
  openSealAssignments,
  orderedSealCandidates,
  sealLiveSwapLabel,
  sealProviderLabel
} from './seal-account-presentation'
import type { SealAccountsStatusRead, SealAutoSwapRead } from './seal-accounts-schemas'
import { SealAccountUsageCard } from './SealAccountUsageCard'
import { SealSessionAccountSheet } from './SealSessionAccountSheet'
import { useSealAccounts } from './use-seal-accounts'

type ToggleKey =
  | 'enabled'
  | 'liveSessionSwap'
  | 'failoverOnAuthError'
  | 'rateLimitFallback'
  | 'apiKeyFallback'

const isSealProvider = (provider: string): provider is SealProvider =>
  SEAL_PROVIDERS.some((known) => known === provider)

// Absent optional switches mean on, as the host reads them.
const toggleValue = (settings: SealAutoSwapRead | undefined, key: ToggleKey) =>
  settings?.[key] ?? (key === 'liveSessionSwap' || key === 'rateLimitFallback')

/** Each provider's accounts and usage, auto-swap switches, manual swaps, and running sessions' accounts. */
export function SealAccountsScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const insets = useSafeAreaInsets()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const connected = state === 'connected'
  const accounts = useSealAccounts(hostId, client, true)
  const { status, busy } = accounts
  const now = useNow(60_000, true)
  const [pulling, setPulling] = useState(false)
  const [sheetSessionId, setSheetSessionId] = useState<string | null>(null)

  const toggles: { key: ToggleKey; label: string; hint: string }[] = [
    {
      key: 'enabled',
      label: t('seal.accounts.autoSwap', 'Auto-swap'),
      hint: t('seal.accounts.autoSwapHint', 'Switch accounts before one runs out')
    },
    {
      key: 'liveSessionSwap',
      label: t('seal.accounts.liveSessionSwap', 'Move running sessions'),
      hint: t('seal.accounts.liveSessionSwapHint', 'Sessions already running follow the swap')
    },
    {
      key: 'failoverOnAuthError',
      label: t('seal.accounts.failover', 'Swap when signed out'),
      hint: t('seal.accounts.failoverHint', 'Move off an account whose login stops working')
    },
    {
      key: 'rateLimitFallback',
      label: t('seal.accounts.rateLimitFallback', 'Swap on limit messages'),
      hint: t('seal.accounts.rateLimitFallbackHint', 'When an agent stops at a limit usage missed')
    },
    {
      key: 'apiKeyFallback',
      label: t('seal.accounts.apiKeyFallback', 'Fall back to API keys'),
      hint: t(
        'seal.accounts.apiKeyFallbackHint',
        'Pay-as-you-go once every subscription is used up'
      )
    }
  ]

  const disabled = !connected || busy !== null
  const providers = Object.entries(status?.providers ?? {}).filter(
    (entry): entry is [SealProvider, SealAccountsStatusRead['providers'][string]] =>
      isSealProvider(entry[0]) && entry[1].candidates.length > 0
  )
  const sessions = openSealAssignments(status)
  const sheetAssignment = sessions.find((entry) => entry.id === sheetSessionId) ?? null

  const frame = (body: ReactNode) => (
    <SealScreenFrame hostId={hostId} title={t('seal.accounts.title', 'Accounts')}>
      {body}
    </SealScreenFrame>
  )
  if (!status) {
    if (!connected) {
      return frame(<MobileOfflineState hostName={hostName} />)
    }
    if (accounts.loadError) {
      return frame(
        <MobileLoadErrorState error={accounts.loadError} onRetry={() => void accounts.refetch()} />
      )
    }
    return frame(<MobileStateView loading title={t('seal.accounts.loading', 'Loading accounts')} />)
  }
  if (providers.length === 0) {
    return frame(
      <MobileStateView
        icon={UserRound}
        title={t('seal.accounts.emptyTitle', 'No accounts yet')}
        message={t(
          'seal.accounts.emptyMessage',
          'Add Claude or Codex accounts in Seal’s settings on your computer to swap between them here.'
        )}
      />
    )
  }

  return frame(
    <>
      <ScrollView
        contentContainerStyle={[sealStyles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={pulling && connected}
            tintColor={colors.textSecondary}
            onRefresh={() => {
              setPulling(true)
              void accounts.refreshUsage().finally(() => setPulling(false))
            }}
          />
        }
      >
        {providers.map(([provider, entry], index) => {
          const settings = status.config.autoSwap[provider]
          return (
            <View key={provider}>
              <SectionHeader title={sealProviderLabel(provider)} first={index === 0} />
              <ListGroup style={sealStyles.group}>
                {toggles.map((toggle) => (
                  <ListRow
                    key={toggle.key}
                    title={toggle.label}
                    subtitle={toggle.hint}
                    accessory={
                      busy === `auto:${provider}:${toggle.key}` ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      ) : (
                        <MobileSwitch
                          value={toggleValue(settings, toggle.key)}
                          disabled={disabled || (toggle.key !== 'enabled' && !settings?.enabled)}
                          accessibilityLabel={`${sealProviderLabel(provider)} ${toggle.label}`}
                          onValueChange={(value) =>
                            void accounts.mutate(`auto:${provider}:${toggle.key}`, {
                              kind: 'auto-swap',
                              provider,
                              settings: { [toggle.key]: value }
                            })
                          }
                        />
                      )
                    }
                  />
                ))}
              </ListGroup>
              {entry.lastDecision ? (
                <Text style={sealStyles.hint}>{entry.lastDecision.summary}</Text>
              ) : null}
              {orderedSealCandidates(entry.candidates).map((candidate) => (
                <SealAccountUsageCard key={candidate.key} candidate={candidate} now={now}>
                  {canUseSealCandidate(candidate) ? (
                    <CardButton
                      label={t('seal.accounts.useAccount', 'Use for new sessions')}
                      busy={busy === `swap:${provider}:${candidate.key}`}
                      disabled={disabled}
                      onPress={() =>
                        void accounts.mutate(`swap:${provider}:${candidate.key}`, {
                          kind: 'swap',
                          provider,
                          account: candidate.key
                        })
                      }
                    />
                  ) : null}
                </SealAccountUsageCard>
              ))}
              <CardButton
                label={t('seal.accounts.swapNow', 'Pick the best account now')}
                busy={busy === `swap:${provider}`}
                disabled={disabled}
                onPress={() => void accounts.mutate(`swap:${provider}`, { kind: 'swap', provider })}
              />
            </View>
          )
        })}

        <SectionHeader title={t('seal.accounts.sessions', 'Running sessions')} />
        {sessions.length === 0 ? (
          <Text style={sealStyles.hint}>
            {t('seal.accounts.noSessions', 'No sessions Seal launched are open.')}
          </Text>
        ) : (
          <ListGroup>
            {sessions.map((session) => (
              <ListRow
                key={session.id}
                title={session.projectLabel ?? sealProviderLabel(session.provider)}
                subtitle={`${sealProviderLabel(session.provider)} · ${session.accountLabel} · ${sealLiveSwapLabel(session.liveSwap ?? 'inherit')}`}
                navigates
                busy={busy === `session:${session.id}`}
                disabled={!connected}
                onPress={() => setSheetSessionId(session.id)}
              />
            ))}
          </ListGroup>
        )}
      </ScrollView>
      <SealSessionAccountSheet
        assignment={sheetAssignment}
        status={status}
        onMutate={(busyKey, mutation) => void accounts.mutate(busyKey, mutation)}
        onClose={() => setSheetSessionId(null)}
      />
      <ConfirmModal
        visible={accounts.error !== null}
        title={t('seal.accounts.failedTitle', 'Couldn’t change the account')}
        message={accounts.error ?? undefined}
        confirmLabel={t('common.ok', 'OK')}
        cancelLabel={null}
        onCancel={accounts.clearError}
      />
    </>
  )
}

function CardButton({
  label,
  busy,
  disabled,
  onPress
}: {
  label: string
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        sealStyles.textButton,
        { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
        disabled && !busy && { opacity: 0.4 },
        pressed && pressedStyle
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      <Text style={sealStyles.textButtonLabel}>{label}</Text>
    </Pressable>
  )
}
