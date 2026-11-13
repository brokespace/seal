import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { NavBar } from '../components/nav-bar/NavBar'
import { NavBarButton } from '../components/nav-bar/NavBarButton'
import { loadHosts, peekHosts } from '../host-catalog/host-store'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useRouteHandoff } from '../navigation/route-handoff'
import { colors } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'

export function useSealHostName(hostId: string): string {
  // Seed from the last host read so the subtitle is there on the first frame.
  const [name, setName] = useState(() => peekHosts()?.find((h) => h.id === hostId)?.name ?? '')
  useEffect(() => {
    let stale = false
    void loadHosts().then((hosts) => {
      const host = hosts.find((h) => h.id === hostId)
      if (!stale && host) {
        setName(host.name)
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])
  return name
}

/** Every Seal screen's chrome: Back, a title over the host's name, and the content below. */
export function SealScreenFrame({
  hostId,
  title,
  subtitle,
  trailing,
  refreshing,
  children
}: {
  hostId: string
  title: string
  /** Defaults to the host's name. */
  subtitle?: string
  trailing?: ReactNode
  refreshing?: boolean
  children: ReactNode
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouteHandoff()
  const hostName = useSealHostName(hostId)
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <NavBar
        leading={
          <NavBarButton
            icon={ChevronLeft}
            onPress={() => router.back()}
            accessibilityLabel={t('common.back', 'Back')}
          />
        }
        title={title}
        subtitle={subtitle ?? (hostName || undefined)}
        trailing={trailing}
        refreshing={refreshing}
      />
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  )
}

const styles = themedStyleSheet(() => ({
  container: { flex: 1, backgroundColor: colors.bgBase },
  body: { flex: 1 }
}))
