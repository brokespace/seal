import { useState } from 'react'
import { RefreshControl, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame } from '../SealScreenFrame'
import { LiveSessionsHostList, useLiveSessionsHost } from './LiveSessionsHostList'

/** Every agent session the host sees: what needs the person first, then all of them by project and workspace. */
export function LiveSessionsScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const insets = useSafeAreaInsets()
  const host = useLiveSessionsHost(hostId)
  const [pulling, setPulling] = useState(false)
  return (
    <SealScreenFrame hostId={hostId} title={t('seal.liveSessions.title', 'Live sessions')}>
      <LiveSessionsHostList
        hostId={hostId}
        host={host}
        wrapRows={(rows) => (
          <ScrollView
            contentContainerStyle={[
              sealStyles.scroll,
              { paddingBottom: insets.bottom + spacing.xl }
            ]}
            refreshControl={
              <RefreshControl
                refreshing={pulling && host.connected}
                tintColor={colors.textSecondary}
                onRefresh={() => {
                  setPulling(true)
                  void host.feed.refresh().finally(() => setPulling(false))
                }}
              />
            }
          >
            {rows}
          </ScrollView>
        )}
      />
    </SealScreenFrame>
  )
}
