import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { MobileMachineDiskMount, MobileMachineDiskStatus } from './machine-disk-index-schemas'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { formatMachineBytes, formatMachineUptime } from './machine-vitals-format'

/** A machine's disks with how full each is, and how current the machine's index of it is. */
export function MachineDiskMounts({
  status,
  activeMount,
  onOpen
}: {
  status: MobileMachineDiskStatus
  activeMount: string | null
  onOpen: (mount: string) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const scan = status.scan
  const note = (mount: MobileMachineDiskMount): string | null => {
    if (status.source === 'live') {
      return null
    }
    if (!mount.indexed) {
      return t('seal.machines.disk.mountSkipped', 'Not indexed')
    }
    if (mount.scannedAt === null) {
      return t('seal.machines.disk.mountWaiting', 'First scan in progress')
    }
    return t('seal.machines.disk.mountAge', 'Indexed {{age}} ago', {
      age: formatMachineUptime(Math.max(0, (status.now - mount.scannedAt) / 1000))
    })
  }
  const unavailable = {
    'no-node': t(
      'seal.machines.disk.unavailable.noNode',
      'This machine has no Node.js 20 or newer, so the background index cannot run on it.'
    ),
    'no-program': t(
      'seal.machines.disk.unavailable.noProgram',
      'Seal could not read its disk index program on this machine.'
    ),
    'install-failed': t(
      'seal.machines.disk.unavailable.installFailed',
      'The disk index program could not be copied to this machine.'
    ),
    'daemon-failed': t(
      'seal.machines.disk.unavailable.daemonFailed',
      'The background index did not start on this machine.'
    ),
    'command-failed': t(
      'seal.machines.disk.unavailable.commandFailed',
      'The command that starts the background index failed on this machine.'
    )
  }
  return (
    <View style={styles.card}>
      {status.mounts.map((mount) => {
        const percent = mount.totalBytes > 0 ? (mount.usedBytes / mount.totalBytes) * 100 : 0
        const detail = note(mount)
        return (
          <Pressable
            key={mount.mount}
            style={({ pressed }) => [styles.diskMount, pressed && styles.rowPressed]}
            onPress={() => onOpen(mount.mount)}
            accessibilityRole="button"
            accessibilityState={{ selected: activeMount === mount.mount }}
            accessibilityLabel={mount.mount}
          >
            <View style={styles.vitalRow}>
              <Text
                style={[styles.cardMeta, styles.mono, styles.rowText]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {mount.mount}
              </Text>
              <Text style={styles.vitalValue} numberOfLines={1}>
                {t('seal.machines.vitals.usedOf', '{{used}} of {{total}}', {
                  used: formatMachineBytes(mount.usedBytes),
                  total: formatMachineBytes(mount.totalBytes)
                })}
              </Text>
            </View>
            <View style={styles.vitalTrack}>
              <View
                style={[
                  styles.vitalFill,
                  percent >= 90
                    ? styles.vitalFillCritical
                    : percent >= 75 && styles.vitalFillWarning,
                  { width: `${Math.max(2, percent)}%` }
                ]}
              />
            </View>
            {detail ? <Text style={styles.cardDetail}>{detail}</Text> : null}
          </Pressable>
        )
      })}
      {scan ? (
        <View style={styles.vitalRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={[styles.cardDetail, styles.rowText]} numberOfLines={2}>
            {scan.expectedFolders
              ? t('seal.machines.disk.rescanning', 'Checking {{mount}} for changes: {{percent}}%', {
                  mount: scan.mount,
                  percent: Math.min(99, Math.floor((scan.folders / scan.expectedFolders) * 100))
                })
              : t('seal.machines.disk.scanning', 'Scanning {{mount}}: {{size}} so far', {
                  mount: scan.mount,
                  size: formatMachineBytes(scan.bytes)
                })}
          </Text>
        </View>
      ) : status.source === 'live' ? (
        <>
          <Text
            style={styles.cardDetail}
          >{`${unavailable[status.unavailableReason ?? 'daemon-failed']} ${t(
            'seal.machines.disk.live',
            'Folders are measured when you open them.'
          )}`}</Text>
          {status.unavailableDetail ? (
            <Text style={[styles.cardDetail, styles.mono]}>{status.unavailableDetail}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
}
