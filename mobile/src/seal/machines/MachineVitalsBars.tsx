import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { MobileMachineMetrics } from './machine-reply-schemas'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { formatMachineBytes, formatMachineUptime, machineVitals } from './machine-vitals-format'

function VitalBar({
  label,
  percent,
  value,
  onPress
}: {
  label: string
  percent: number
  value: string
  /** Makes the bar a button that opens what is using this resource. */
  onPress?: () => void
}) {
  const bar = (
    <View style={styles.vitalRow} accessible={!onPress} accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.vitalLabel}>{label}</Text>
      <View style={styles.vitalTrack}>
        <View
          style={[
            styles.vitalFill,
            percent >= 90 ? styles.vitalFillCritical : percent >= 75 && styles.vitalFillWarning,
            { width: `${Math.max(2, percent)}%` }
          ]}
        />
      </View>
      <Text style={styles.vitalValue} numberOfLines={1}>
        {value}
      </Text>
      {onPress ? <ChevronRight size={14} color={colors.textMuted} /> : null}
    </View>
  )
  return onPress ? (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => pressed && pressedStyle}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}`}
      hitSlop={8}
    >
      {bar}
    </Pressable>
  ) : (
    bar
  )
}

/** Load, memory and disk bars plus uptime; rows the machine does not report are left out. */
export function MachineVitalsBars({
  metrics,
  loading,
  onOpenDisk
}: {
  metrics: MobileMachineMetrics | undefined
  loading: boolean
  onOpenDisk?: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  if (!metrics) {
    return loading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null
  }
  const vitals = machineVitals(metrics)
  const percent = (value: number) => `${Math.round(value)}%`
  const capacity = (total: number | null, available: number | null, used: number) =>
    total !== null && available !== null
      ? t('seal.machines.vitals.usedOf', '{{used}} of {{total}}', {
          used: formatMachineBytes(total - available),
          total: formatMachineBytes(total)
        })
      : percent(used)
  return (
    <View style={styles.vitals}>
      {vitals.cpuPercent !== null ? (
        <VitalBar
          label={
            metrics.loadAverage
              ? t('seal.machines.vitals.load', 'Load')
              : t('seal.machines.vitals.cpu', 'CPU')
          }
          percent={vitals.cpuPercent}
          value={
            metrics.loadAverage
              ? `${metrics.loadAverage[0].toFixed(2)} · ${percent(vitals.cpuPercent)}`
              : percent(vitals.cpuPercent)
          }
        />
      ) : null}
      {vitals.memoryPercent !== null ? (
        <VitalBar
          label={t('seal.machines.vitals.memory', 'Memory')}
          percent={vitals.memoryPercent}
          value={capacity(metrics.memTotalBytes, metrics.memAvailableBytes, vitals.memoryPercent)}
        />
      ) : null}
      {vitals.diskPercent !== null ? (
        <VitalBar
          label={t('seal.machines.vitals.disk', 'Disk')}
          percent={vitals.diskPercent}
          value={capacity(metrics.diskTotalBytes, metrics.diskAvailableBytes, vitals.diskPercent)}
          onPress={onOpenDisk}
        />
      ) : null}
      {metrics.uptimeSeconds !== null ? (
        <Text style={styles.cardDetail}>
          {t('seal.machines.vitals.uptime', 'Up {{uptime}}', {
            uptime: formatMachineUptime(metrics.uptimeSeconds)
          })}
        </Text>
      ) : null}
    </View>
  )
}
