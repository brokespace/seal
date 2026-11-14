import { useState } from 'react'
import { Text, View } from 'react-native'
import { ListChecks, MessageCircleQuestionMark } from 'lucide-react-native'
import { BottomDrawer } from '../../components/bottom-drawer/BottomDrawer'
import { ListGroup, ListRow, SectionHeader } from '../../components/list/ListGroup'
import { SheetHeader } from '../../components/nav-bar/SheetHeader'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type {
  RecapItem,
  RecapItemMark,
  SessionRecap,
  SessionRecapView
} from '../../../../src/shared/session-recap/session-recap-types'
import {
  recapHasContent,
  recapItemIsNew,
  recapItemsByMark,
  recapNewsSinceLastLook,
  recapWorkByState
} from '../../../../src/shared/session-recap/session-recap-view'
import { sealStyles } from '../seal-screen-styles'
import { recapClockTime, recapItemKindLabel, recapStateNote } from './session-recap-copy'
import {
  RecapLineRow,
  RecapReferenceRow,
  RecapTickRow,
  RecapWorkRow,
  type RecapJump
} from './SessionRecapRows'

type Handlers = {
  onMark: (itemId: string, mark: RecapItemMark | null) => void
  onJump: RecapJump
  onOpenLink: (url: string) => void
}

export type SessionRecapSheetProps = Handlers & {
  visible: boolean
  /** Null until the host has answered. */
  view: SessionRecapView | null
  refreshing: boolean
  onRefresh: () => void
  onClose: () => void
}

/** Open questions or action items, then the ones already ticked or dismissed behind a disclosure. */
function TickSection({
  title,
  icon,
  items,
  view,
  onMark,
  onJump
}: Pick<Handlers, 'onMark' | 'onJump'> & {
  title: string
  icon: React.ReactNode
  items: readonly RecapItem[]
  view: SessionRecapView
}) {
  const t = useMobileTranslation()
  const [showSettled, setShowSettled] = useState(false)
  const { open, settled } = recapItemsByMark(items, view.marks)
  if (items.length === 0) {
    return null
  }
  const row = (item: RecapItem) => (
    <RecapTickRow
      key={item.id}
      item={item}
      mark={view.marks[item.id]}
      isNew={recapItemIsNew(view, item)}
      onMark={onMark}
      onJump={onJump}
    />
  )
  return (
    <View>
      <SectionHeader title={title} icon={icon} trailing={String(open.length)} />
      <ListGroup>
        {open.map(row)}
        {open.length === 0 ? (
          <ListRow key="none" title={t('seal.sessionRecap.allSettled', 'Nothing open.')} disabled />
        ) : null}
        {settled.length > 0 ? (
          <ListRow
            key="settled"
            title={t('seal.sessionRecap.settled', '{{count}} done or dismissed', {
              count: settled.length
            })}
            value={
              showSettled
                ? t('seal.sessionRecap.hide', 'Hide')
                : t('seal.sessionRecap.show', 'Show')
            }
            onPress={() => setShowSettled((shown) => !shown)}
            testID="recap-settled"
          />
        ) : null}
        {showSettled ? settled.map(row) : null}
      </ListGroup>
    </View>
  )
}

function Section({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <View>
      <SectionHeader title={title} trailing={count ? String(count) : undefined} />
      <ListGroup>{children}</ListGroup>
    </View>
  )
}

function RecapSections({
  recap,
  view,
  onMark,
  onJump,
  onOpenLink
}: Handlers & { recap: SessionRecap; view: SessionRecapView }) {
  const t = useMobileTranslation()
  const news = recapNewsSinceLastLook(view)
  const work = recapWorkByState(recap.did)
  const line = (item: RecapItem) => <RecapLineRow key={item.id} item={item} onJump={onJump} />
  const prose = (key: string, text: string) => (
    <Text key={key} style={styles.prose}>
      {text}
    </Text>
  )
  return (
    <>
      {recap.goal ? (
        <Section title={t('seal.sessionRecap.goal', 'Goal')}>{prose('goal', recap.goal)}</Section>
      ) : null}
      {recap.standing ? (
        <Section title={t('seal.sessionRecap.standing', 'Where it stands')}>
          {prose('standing', recap.standing)}
        </Section>
      ) : null}
      {news.length > 0 && view.since !== null ? (
        <View>
          <SectionHeader
            title={t('seal.sessionRecap.news', 'Since you last looked')}
            trailing={recapClockTime(view.since)}
          />
          <ListGroup>
            {news.map(({ section, item }) =>
              section === 'did' ? (
                <RecapWorkRow
                  key={item.id}
                  item={item}
                  label={recapItemKindLabel(section, item)}
                  onJump={onJump}
                />
              ) : (
                <RecapLineRow
                  key={item.id}
                  item={item}
                  kind={recapItemKindLabel(section, item)}
                  onJump={onJump}
                />
              )
            )}
          </ListGroup>
        </View>
      ) : null}
      <TickSection
        title={t('seal.sessionRecap.questions', 'Questions for you')}
        icon={
          <MessageCircleQuestionMark size={14} color={colors.textSecondary} strokeWidth={2.2} />
        }
        items={recap.questions}
        view={view}
        onMark={onMark}
        onJump={onJump}
      />
      <TickSection
        title={t('seal.sessionRecap.actions', 'Your action items')}
        icon={<ListChecks size={14} color={colors.textSecondary} strokeWidth={2.2} />}
        items={recap.actions}
        view={view}
        onMark={onMark}
        onJump={onJump}
      />
      {recap.ignored.length > 0 ? (
        <Section
          title={t('seal.sessionRecap.ignored', 'Asked but not addressed')}
          count={recap.ignored.length}
        >
          {recap.ignored.map(line)}
        </Section>
      ) : null}
      {recap.asked.length > 0 ? (
        <Section title={t('seal.sessionRecap.asked', 'What you asked')} count={recap.asked.length}>
          {recap.asked.map(line)}
        </Section>
      ) : null}
      {work.length > 0 ? (
        <Section title={t('seal.sessionRecap.did', 'What the agent did')}>
          {work.flatMap((group) =>
            group.items.map((item) => (
              <RecapWorkRow
                key={item.id}
                item={item}
                label={recapItemKindLabel('did', item)}
                onJump={onJump}
              />
            ))
          )}
        </Section>
      ) : null}
      {recap.decisions.length > 0 ? (
        <Section title={t('seal.sessionRecap.decisions', 'Decisions')}>
          {recap.decisions.map(line)}
        </Section>
      ) : null}
      {recap.references.length > 0 ? (
        <Section title={t('seal.sessionRecap.references', 'Files, PRs and links')}>
          {recap.references.map((reference) => (
            <RecapReferenceRow
              key={`${reference.kind}:${reference.target}`}
              reference={reference}
              onJump={onJump}
              onOpenLink={onOpenLink}
            />
          ))}
        </Section>
      ) : null}
    </>
  )
}

/** The whole recap, over the transcript: what the session is for, where it stands, what waits on the user. */
export function SessionRecapSheet({
  visible,
  view,
  refreshing,
  onRefresh,
  onClose,
  ...handlers
}: SessionRecapSheetProps) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const recap = view?.recap ?? null
  const updating = refreshing || view?.state === 'updating'
  const note = view ? recapStateNote(view) : null
  const subtitle = updating
    ? t('seal.sessionRecap.updating', 'Updating\u2026')
    : recap
      ? t('seal.sessionRecap.updatedAt', 'Updated {{time}}', {
          time: recapClockTime(recap.updatedAt)
        })
      : undefined
  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <SheetHeader
        title={t('seal.sessionRecap.title', 'Recap')}
        subtitle={subtitle}
        leading={{
          label: t('seal.sessionRecap.refreshShort', 'Refresh'),
          onPress: onRefresh,
          busy: updating,
          disabled: view === null || view.state === 'unavailable' || view.state === 'paused'
        }}
        trailing={{ label: t('common.done', 'Done'), onPress: onClose }}
      />
      {note ? <Text style={sealStyles.hint}>{note}</Text> : null}
      {recap && recap.coveredFrom > 0 ? (
        <Text style={sealStyles.hint}>
          {t(
            'seal.sessionRecap.partialLong',
            'This recap covers the recent part of a long session.'
          )}
        </Text>
      ) : null}
      {view !== null && recapHasContent(recap) ? (
        <RecapSections recap={recap} view={view} {...handlers} />
      ) : updating || view === null ? (
        <Text style={sealStyles.hint}>
          {t('seal.sessionRecap.writing', 'Reading the session\u2026')}
        </Text>
      ) : null}
    </BottomDrawer>
  )
}

const styles = themedStyleSheet(() => ({
  prose: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typography.bodySize,
    lineHeight: 20,
    color: colors.textPrimary
  }
}))
