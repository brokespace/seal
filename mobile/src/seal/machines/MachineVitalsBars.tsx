import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { summarizeMachineGpus } from '../../../../src/shared/machines/machine-gpu-types'
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
  onPress,
  neutral = false,
  expanded
}: {
  label: string
  percent: number
  value: string
  /** Makes the bar a button that opens what is using this resource. */
  onPress?: () => void
  /** For a share that is fine at 100%, like GPU load: the bar never turns amber or red. */
  neutral?: boolean
  /** Set on a bar that unfolds rows below it instead of opening a screen. */
  expanded?: boolean
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  const bar = (
    <View style={styles.vitalRow} accessible={!onPress} accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.vitalLabel}>{label}</Text>
      <View style={styles.vitalTrack}>
        <View
          style={[
            styles.vitalFill,
            !neutral &&
              (percent >= 90 ? styles.vitalFillCritical : percent >= 75 && styles.vitalFillWarning),
            { width: `${Math.max(2, percent)}%` }
          ]}
        />
      </View>
      <Text style={styles.vitalValue} numberOfLines={1}>
        {value}
      </Text>
      {onPress ? <Chevron size={14} color={colors.textMuted} /> : null}
    </View>
  )
  return onPress ? (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => pressed && pressedStyle}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}`}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      hitSlop={8}
    >
      {bar}
    </Pressable>
  ) : (
    bar
  )
}

/**
 * Load, memory, disk and GPU bars plus uptime; rows the machine does not report are left out.
 * With `eachGpu`, the GPU bar unfolds into one bar per GPU.
 */
export function MachineVitalsBars({
  metrics,
  loading,
  onOpenDisk,
  eachGpu = false
}: {
  metrics: MobileMachineMetrics | undefined
  loading: boolean
  onOpenDisk?: () => void
  eachGpu?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [gpusOpen, setGpusOpen] = useState(false)
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
  const gpuValue = (gpu: {
    utilizationPercent: number | null
    memoryUsedBytes: number | null
    memoryTotalBytes: number | null
  }): string =>
    [
      gpu.utilizationPercent === null ? null : percent(gpu.utilizationPercent),
      gpu.memoryUsedBytes === null
        ? null
        : gpu.memoryTotalBytes === null
          ? formatMachineBytes(gpu.memoryUsedBytes)
          : t('seal.machines.vitals.usedOf', '{{used}} of {{total}}', {
              used: formatMachineBytes(gpu.memoryUsedBytes),
              total: formatMachineBytes(gpu.memoryTotalBytes)
            })
    ]
      .filter(Boolean)
      .join(' · ') || '–'
  const gpus = metrics.gpus
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
      {gpus.length > 0 ? (
        <VitalBar
          label={
            gpus.length > 1
              ? t('seal.machines.vitals.gpuCount', 'GPU ×{{count}}', { count: gpus.length })
              : t('seal.machines.vitals.gpu', 'GPU')
          }
          percent={summarizeMachineGpus(gpus).utilizationPercent ?? 0}
          value={gpuValue(summarizeMachineGpus(gpus))}
          neutral
          {...(eachGpu && gpus.length > 1
            ? { onPress: () => setGpusOpen((open) => !open), expanded: gpusOpen }
            : {})}
        />
      ) : null}
      {eachGpu && gpusOpen
        ? gpus.map((gpu) => (
            <VitalBar
              key={gpu.index}
              label={t('seal.machines.vitals.gpuIndex', 'GPU {{index}}', { index: gpu.index })}
              percent={gpu.utilizationPercent ?? 0}
              value={gpuValue(gpu)}
              neutral
            />
          ))
        : null}
      {eachGpu && gpus.length > 0 ? (
        <Text style={styles.cardDetail} numberOfLines={1}>
          {[...new Set(gpus.map((gpu) => gpu.name).filter(Boolean))].join(', ')}
        </Text>
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
