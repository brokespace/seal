import { Text, View } from 'react-native'
import { TriangleAlert } from 'lucide-react-native'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { PairingOfferIdentity } from './pairing-offer-identity'

/** What a pairing code would connect this phone to, shown before the user confirms it. */
export function PairConfirmHostIdentity({ identity }: { identity: PairingOfferIdentity }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <IdentityRow
          label={t('seal.pairConfirm.computerLabel', 'Computer')}
          value={
            identity.knownHostName ??
            t('seal.pairConfirm.newComputer', 'Not paired with this phone yet')
          }
        />
        {identity.fingerprint ? (
          <IdentityRow
            label={t('seal.pairConfirm.fingerprintLabel', 'Key fingerprint')}
            value={identity.fingerprint}
            literal
          />
        ) : null}
        {identity.relayOrigin ? (
          <IdentityRow
            label={t('seal.pairConfirm.relayLabel', 'Relay')}
            value={identity.relayOrigin}
            literal
          />
        ) : null}
        <IdentityRow
          label={t('seal.pairConfirm.directLabel', 'Direct address')}
          value={identity.directEndpoint}
          literal
        />
      </View>
      {identity.knownHostName ? (
        <Notice
          text={t(
            'seal.pairConfirm.replaceNotice',
            'This will replace your existing pairing with {{name}}.',
            { name: identity.knownHostName }
          )}
        />
      ) : null}
      {identity.usesOtherRelay && identity.relayOrigin ? (
        <Notice
          text={t(
            'seal.pairConfirm.otherRelayNotice',
            'This code uses {{origin}} instead of the relay built into this app. Pair only if you trust whoever runs it.',
            { origin: identity.relayOrigin }
          )}
        />
      ) : null}
    </View>
  )
}

function IdentityRow({
  label,
  value,
  literal = false
}: {
  label: string
  value: string
  literal?: boolean
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, literal && styles.literal]} selectable>
        {value}
      </Text>
    </View>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <TriangleAlert size={16} color={colors.statusAmber} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  stack: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md
  },
  row: {
    gap: spacing.xs
  },
  label: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  value: {
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  literal: {
    fontFamily: typography.monoFamily
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  noticeText: {
    flex: 1,
    fontSize: typography.bodySize,
    lineHeight: 20,
    color: colors.textPrimary
  }
}))
