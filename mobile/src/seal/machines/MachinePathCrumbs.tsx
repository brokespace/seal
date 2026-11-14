import { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { machinePathCrumbs } from '../../../../src/shared/machines/machine-paths'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { machineScreenStyles as styles } from './machine-screen-styles'

/** A path as tappable segments; each one opens that folder. */
export function MachinePathCrumbs({
  path,
  onOpen
}: {
  path: string
  onOpen: (path: string) => void
}) {
  const crumbs = useMemo(() => machinePathCrumbs(path), [path])
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.crumbs}
      contentContainerStyle={styles.crumbsContent}
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1
        return (
          <View key={crumb.path} style={styles.vitalRow}>
            {index > 0 ? <ChevronRight size={12} color={colors.textMuted} /> : null}
            <Pressable
              style={({ pressed }) => [styles.crumb, pressed && pressedStyle]}
              onPress={() => onOpen(crumb.path)}
              disabled={last}
              accessibilityRole="link"
            >
              <Text style={[styles.crumbText, last && styles.crumbCurrent]} numberOfLines={1}>
                {crumb.label}
              </Text>
            </Pressable>
          </View>
        )
      })}
    </ScrollView>
  )
}
