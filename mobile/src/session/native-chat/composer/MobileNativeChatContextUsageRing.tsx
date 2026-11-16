import {
  StyleSheet,
  Pressable,
  View,
  type HostInstance,
  type LayoutChangeEvent
} from 'react-native'
import { memo, useCallback, useRef, useState } from 'react'
import Svg, { Circle } from 'react-native-svg'
import type { NativeChatContextUsageSummary } from '../../../../../src/shared/native-chat/native-chat-context-usage-summary'
import {
  contextUsageRingReadout,
  isContextUsageMeasured,
  type NativeChatContextUsageState
} from '../../../../../src/shared/native-chat/native-chat-context-usage-state'
import { AnchoredDetailCardLayer } from '../../../components/AnchoredDetailCard'
import { DetailCardFocusBoundary } from '../../../components/detail-card-host'
import {
  useAnchoredDetailCard,
  type DetailCardMeasure
} from '../../../components/use-anchored-detail-card'
import { useDetailCardScope } from '../../../components/use-detail-card-scope'
import {
  COMPOSER_CONTROL_HIT_SLOP,
  composerInputStyles as inputStyles
} from '../../../components/composer-input/composer-input-styles'
import { useNow } from '../../../hooks/use-now'
import { useKeyboardPersistingTaps } from '../../../platform/keyboard/keyboard-persisting-taps'
import { useKeyboardOcclusion } from '../../../platform/keyboard/keyboard-occlusion'
import type { Translate } from '../../../i18n/mobile-i18n'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { colors, spacing } from '../../../theme/mobile-theme'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import type { MobileHostHandle } from '../../../platform/host-handle'
import { MobileNativeChatContextUsageCardBody } from './MobileNativeChatContextUsageCardBody'
import { useMobileNativeChatDictationFailed } from './MobileNativeChatDictationLeading'

const RING_SIZE = 16
const RING_STROKE = 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** Often enough for "Compacted" to end near its minute and for the card's "ago" to stay right. */
const COMPACTION_CLOCK_MS = 30_000

/** The state in words, for the card and the label: a phone's action row has no room beside the ring. */
function contextUsageStateText(state: NativeChatContextUsageState, t: Translate): string | null {
  switch (state) {
    case 'near':
      return t('seal.contextIndicator.compactsSoon', 'Compacts soon')
    case 'critical':
      return t('seal.contextIndicator.almostFull', 'Context almost full')
    case 'compacted':
      return t('seal.contextIndicator.compacted', 'Compacted')
    // The phone is never told a compaction is running.
    case 'compacting':
    case 'unknown':
    case 'normal':
      return null
  }
}

/** The composer box's props, which the card lines its trailing and bottom edges up with, and the
 *  ring for the action row beside Send (null without usage, and while a failed dictation's Retry
 *  has the room). `obscured` is the composer's own menu, which sits where the card would and
 *  closes it. */
export function useMobileNativeChatContextRing(
  usage: NativeChatContextUsageSummary | null,
  obscured: boolean
) {
  const ref = useRef<MobileHostHandle>(null)
  const [height, setHeight] = useState(0)
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    []
  )
  const dictationFailed = useMobileNativeChatDictationFailed()
  // Without usage there is no card to follow the bar, so its height need not re-render the composer.
  return {
    barProps: usage ? { ref, onLayout } : { ref },
    ring:
      usage && !dictationFailed ? (
        <MobileNativeChatContextUsageRing
          usage={usage}
          composerRef={ref}
          composerHeight={height}
          obscured={obscured}
        />
      ) : null
  }
}

/** Composer ring for context-window usage; a tap shows the provider's breakdown above the composer.
 *  Memoized so typing in the draft does not redraw it. */
const MobileNativeChatContextUsageRing = memo(function MobileNativeChatContextUsageRing({
  usage,
  composerRef,
  composerHeight,
  obscured
}: {
  usage: NativeChatContextUsageSummary
  composerRef: React.RefObject<HostInstance | null>
  composerHeight: number
  obscured: boolean
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const keyboard = useKeyboardOcclusion()
  const measure = useCallback<DetailCardMeasure>(
    (place) => {
      const composer = composerRef.current
      if (!composer) {
        place(null)
        return
      }
      // A prompt card hides the composer; a zero box means there is nothing to sit above.
      composer.measureInWindow((x, y, width, height) => {
        place(
          width > 0 && height > 0
            ? { side: 'above', right: x + width, bottom: y - spacing.sm }
            : null
        )
      })
    },
    [composerRef]
  )
  // The composer rides the keyboard and grows with the draft; the open card moves with it.
  const card = useAnchoredDetailCard({
    follow: `${keyboard}:${composerHeight}`,
    obscured,
    measure
  })
  useDetailCardScope({ ...card, obscured })
  // Why: the card is a readout; opening or touching it must keep the draft's keyboard up.
  const openerKeepsKeyboard = useKeyboardPersistingTaps('always')
  const cardKeepsKeyboard = useKeyboardPersistingTaps('always')
  const { openerRef, layerRef } = card
  const attachOpener = useCallback(
    (view: HostInstance | null) => {
      openerRef.current = view
      openerKeepsKeyboard(view)
    },
    [openerRef, openerKeepsKeyboard]
  )
  const attachLayer = useCallback(
    (view: HostInstance | null) => {
      layerRef.current = view
      cardKeepsKeyboard(view)
    },
    [layerRef, cardKeepsKeyboard]
  )
  // Only a compaction makes the readout depend on the time.
  const now = useNow(COMPACTION_CLOCK_MS, usage.lastCompactedAt !== undefined)
  const readout = contextUsageRingReadout(usage, { now })
  const { state, filled, used, window } = readout
  const measured = isContextUsageMeasured(usage)
  const warnTint =
    state === 'near' ? colors.statusAmber : state === 'critical' ? colors.statusRed : null
  const tint = warnTint ?? colors.textMuted
  const stateText = contextUsageStateText(state, t)
  const usageLabel = measured
    ? t('chat.contextUsage.label', 'Context {{used}} of {{window}} tokens, {{percent}}% used', {
        used,
        window,
        percent: String(usage.percentage)
      })
    : t('seal.contextIndicator.empty', 'Context usage appears after the first reply.')
  const label =
    stateText === null
      ? usageLabel
      : t('seal.contextIndicator.labelWithState', '{{label}} ({{state}})', {
          label: usageLabel,
          state: stateText
        })
  return (
    <>
      <DetailCardFocusBoundary refs={card.boundaryRefs} index={0} active={card.active} />
      <Pressable
        ref={attachOpener}
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-expanded={card.requestedOpen}
        testID="native-chat-context-usage"
        style={({ pressed }) => [inputStyles.ghostButton, pressed && inputStyles.pressed]}
        onLayout={card.onAnchorLayout}
        onPress={card.toggle}
        hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      >
        {/* The state as tests read it: react-native-svg drops a testID on the web. */}
        <View pointerEvents="none" testID={`native-chat-context-usage-state-${state}`}>
          <Svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            style={ringStyles.ring}
          >
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={tint}
              strokeWidth={RING_STROKE}
              opacity={0.25}
            />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={tint}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - filled / 100)}
            />
          </Svg>
        </View>
      </Pressable>
      <DetailCardFocusBoundary refs={card.boundaryRefs} index={1} active={card.active} />
      <AnchoredDetailCardLayer
        card={card}
        obscured={obscured}
        layerRef={attachLayer}
        title={t('chat.contextUsage.title', 'Context')}
        titleTrailing={stateText ?? (measured ? `${used}/${window}` : undefined)}
      >
        <MobileNativeChatContextUsageCardBody
          usage={usage}
          readout={readout}
          now={now}
          warnTint={warnTint}
        />
      </AnchoredDetailCardLayer>
    </>
  )
})

const ringStyles = StyleSheet.create({
  ring: { transform: [{ rotate: '-90deg' }] }
})
