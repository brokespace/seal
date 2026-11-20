import { useEffect, useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { Paperclip, Server, Share } from 'lucide-react-native'
import type { HomeChatEntry } from '../../../../src/shared/home-chat/home-chat-types'
import { LoadingSpinner } from '../../components/LoadingSpinner'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { downloadTicketToCache, shareLocalFile } from '../transfers/phone-transfers'
import { formatHomeChatBytes } from './home-chat-format'
import { openHomeChatAttachmentDownload, readHomeChatAttachment } from './home-chat-operations'
import { homeChatStyles as styles } from './home-chat-styles'

type AttachmentEntry = Extract<HomeChatEntry, { kind: 'attachment' }>

// Inline reads travel as one base64 reply; bigger images go through the chunked download instead.
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024

function useInlineImage(client: RpcClient | null, chatId: string, entry: AttachmentEntry) {
  const [uri, setUri] = useState<string | null>(null)
  const inline = entry.mimeType.startsWith('image/') && entry.size <= MAX_INLINE_IMAGE_BYTES
  useEffect(() => {
    if (!inline || !client) {
      return
    }
    let live = true
    readHomeChatAttachment(client, chatId, entry.attachmentId).then(
      ({ mimeType, base64 }) => live && setUri(`data:${mimeType};base64,${base64}`),
      () => live && setUri(null)
    )
    return () => {
      live = false
    }
  }, [inline, client, chatId, entry.attachmentId])
  return uri
}

/** A file the assistant showed: small images inline, anything can be pulled to the phone and shared. */
export function HomeChatAttachmentRow({
  client,
  chatId,
  entry,
  onError
}: {
  client: RpcClient | null
  chatId: string
  entry: AttachmentEntry
  onError: (message: string) => void
}) {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const imageUri = useInlineImage(client, chatId, entry)
  const [received, setReceived] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const share = async () => {
    if (!client || received !== null) {
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setReceived(0)
    try {
      const ticket = await openHomeChatAttachmentDownload(client, chatId, entry.attachmentId)
      const { uri } = await downloadTicketToCache(client, ticket, {
        signal: controller.signal,
        onProgress: setReceived
      })
      if (!controller.signal.aborted) {
        await shareLocalFile(uri, ticket.mimeType || entry.mimeType)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        onError(
          t('seal.homeChat.attachment.downloadFailed', 'Could not download {{name}}: {{reason}}', {
            name: entry.name,
            reason: error instanceof Error ? error.message : String(error)
          })
        )
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setReceived(null)
      }
    }
  }

  const progress =
    received !== null && entry.size > 0
      ? t('seal.homeChat.attachment.progress', '{{percent}}%', {
          percent: Math.min(100, Math.floor((received / entry.size) * 100))
        })
      : null

  return (
    <View style={styles.card}>
      {imageUri ? (
        <Pressable onPress={() => void share()} accessibilityRole="imagebutton">
          <Image
            source={{ uri: imageUri }}
            style={styles.attachmentImage}
            resizeMode="contain"
            accessibilityLabel={entry.name}
          />
        </Pressable>
      ) : null}
      <View style={styles.cardHeader}>
        <Paperclip size={16} color={colors.textSecondary} />
        <View style={styles.cardHeaderMain}>
          <Text style={styles.noticeTitle} numberOfLines={1}>
            {entry.name}
          </Text>
          <View style={styles.cardTitleRow}>
            {entry.machine ? (
              <View style={styles.machineChip}>
                <Server size={11} color={colors.textMuted} />
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {entry.machine}
                </Text>
              </View>
            ) : null}
            <Text style={styles.cardMeta}>{progress ?? formatHomeChatBytes(entry.size)}</Text>
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.iconButton, pressed && pressedStyle]}
          disabled={!client || received !== null}
          onPress={() => void share()}
          accessibilityRole="button"
          accessibilityLabel={t('seal.homeChat.attachment.share', 'Download and share {{name}}', {
            name: entry.name
          })}
        >
          {received !== null ? (
            <LoadingSpinner size={16} color={colors.textSecondary} />
          ) : (
            <Share size={18} color={colors.textPrimary} />
          )}
        </Pressable>
      </View>
    </View>
  )
}
