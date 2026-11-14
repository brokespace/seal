import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptySessionRecap,
  type RecapItem,
  type SessionRecapView
} from '../../../../src/shared/session-recap/session-recap-types'
import { SessionRecapSheet, type SessionRecapSheetProps } from './SessionRecapSheet'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronRight: 'ChevronRight',
  CircleAlert: 'CircleAlert',
  CircleDot: 'CircleDot',
  ExternalLink: 'ExternalLink',
  FileText: 'FileText',
  GitPullRequest: 'GitPullRequest',
  Link2: 'Link2',
  ListChecks: 'ListChecks',
  MessageCircleQuestionMark: 'MessageCircleQuestionMark',
  Undo2: 'Undo2',
  X: 'X'
}))
vi.mock('../../components/bottom-drawer/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))
vi.mock('../../components/nav-bar/SheetHeader', () => ({ SheetHeader: 'SheetHeader' }))
vi.mock('../../components/MobileDiffReviewFileSummary', () => ({
  ViewedCheckbox: 'ViewedCheckbox'
}))

const LAST_LOOK = 1_000_000

const item = (id: string, text: string, at: number, messageId: string | null): RecapItem => ({
  id,
  text,
  messageId,
  at
})

function recapView(patch: Partial<SessionRecapView> = {}): SessionRecapView {
  return {
    sessionId: 's1',
    recap: {
      ...emptySessionRecap(LAST_LOOK + 500),
      goal: 'Move billing webhooks to the queue',
      questions: [
        item('q1', 'Refund duplicates automatically?', LAST_LOOK + 100, 'm40'),
        item('q2', 'Keep the old handler for one release?', LAST_LOOK - 100, 'm20')
      ],
      actions: [item('t3', 'Review the worker PR', LAST_LOOK - 100, null)],
      references: [
        {
          kind: 'pr',
          label: 'acme/billing#482',
          target: 'https://github.com/acme/billing/pull/482',
          messageId: 'm30',
          at: LAST_LOOK - 50
        }
      ]
    },
    marks: {},
    since: LAST_LOOK,
    state: 'ready',
    stale: false,
    pausedUntil: null,
    failure: null,
    rev: 3,
    ...patch
  }
}

let renderer: ReactTestRenderer | null = null

function render(patch: Partial<SessionRecapSheetProps> = {}) {
  const handlers = {
    onMark: vi.fn(),
    onJump: vi.fn(),
    onOpenLink: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn()
  }
  act(() => {
    renderer = create(
      createElement(SessionRecapSheet, {
        visible: true,
        view: recapView(),
        refreshing: false,
        ...handlers,
        ...patch
      })
    )
  })
  return handlers
}

const root = (): ReactTestInstance => {
  if (!renderer) {
    throw new Error('not rendered')
  }
  return renderer.root
}
const byTestId = (testID: string) =>
  root().findAll((node) => typeof node.type === 'string' && node.props.testID === testID)
const press = (node: ReactTestInstance) => act(() => node.props.onPress())

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('SessionRecapSheet', () => {
  it('ticks a question as done and dismisses an action item', () => {
    const { onMark } = render()

    press(byTestId('recap-item-q1')[0].find((node) => String(node.type) === 'ViewedCheckbox'))
    press(byTestId('recap-dismiss-t3')[0])

    expect(onMark.mock.calls).toEqual([
      ['q1', 'done'],
      ['t3', 'dismissed']
    ])
  })

  it('keeps settled items out of sight until asked for, and can bring one back', () => {
    const { onMark } = render({ view: recapView({ marks: { q1: 'done', t3: 'dismissed' } }) })

    expect(byTestId('recap-item-q1')).toHaveLength(0)
    expect(byTestId('recap-item-q2')).toHaveLength(1)

    press(byTestId('recap-settled')[0])
    press(byTestId('recap-settled')[1])
    expect(byTestId('recap-item-q1')).toHaveLength(1)
    press(byTestId('recap-restore-t3')[0])

    expect(onMark.mock.calls).toEqual([['t3', null]])
  })

  it('sends a pressed item to its message and a pull request to the browser', () => {
    const { onJump, onOpenLink } = render()

    press(byTestId('recap-jump-m40')[0])
    press(byTestId('recap-open-https://github.com/acme/billing/pull/482')[0])

    expect(onJump.mock.calls).toEqual([['m40']])
    expect(onOpenLink.mock.calls).toEqual([['https://github.com/acme/billing/pull/482']])
  })

  it('flags only the question raised since the last visit as new', () => {
    render()

    const flagged = (id: string) =>
      byTestId(`recap-item-${id}`)[0].findAll((node) => node.props.testID === 'recap-new').length

    expect(flagged('q1')).toBe(1)
    expect(flagged('q2')).toBe(0)
  })
})
