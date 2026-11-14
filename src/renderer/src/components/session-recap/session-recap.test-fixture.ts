import { SAMPLE_NOW } from '@/components/live-sessions/live-session.test-fixture'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import {
  emptySessionRecap,
  type LiveSessionRecapBrief,
  type RecapItem,
  type RecapWorkState,
  type SessionRecap,
  type SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'

const MIN = 60_000
const HOUR = 60 * MIN

function item(
  id: string,
  text: string,
  messageId: string | null,
  agoMs: number,
  state?: RecapWorkState
): RecapItem {
  return { id, text, messageId, at: SAMPLE_NOW - agoMs, ...(state ? { state } : {}) }
}

/** A session a day into a billing migration, for tests and fixtures. */
export function sampleSessionRecap(patch: Partial<SessionRecap> = {}): SessionRecap {
  return {
    ...emptySessionRecap(SAMPLE_NOW - 4 * MIN),
    title: 'Move billing webhooks to the queue',
    titleChangedAt: SAMPLE_NOW - 26 * HOUR,
    goal: 'Stop Stripe webhook retries from double-charging by moving webhook handling onto the job queue, behind an idempotency key.',
    standing:
      'The queue worker and idempotency table are merged behind a flag; the backfill script is written but waits on your answer about refunds before it runs.',
    asked: [
      item('a1', 'Find out why some customers were charged twice last week', 'o120', 26 * HOUR),
      item('a2', 'Move webhook handling onto the job queue', 'o2210', 25 * HOUR),
      item('a3', 'Add an idempotency key so retries are safe', 'o4830', 25 * HOUR),
      item('a5', 'Put it behind a flag, off by default', 'o9120', 22 * HOUR),
      item('a8', 'Also log the Stripe event id on every job', 'o15310', 21 * HOUR),
      item('a11', 'Write a backfill for the charges already duplicated', 'o22400', 3 * HOUR),
      item('a14', 'Open a PR for the worker and keep the backfill separate', 'o30870', 2 * HOUR)
    ],
    did: [
      item(
        'w2',
        'Traced the double charges to webhook retries racing the first delivery',
        'o1480',
        26 * HOUR,
        'done'
      ),
      item('w4', 'Added the billing_webhook job and its worker', 'o6020', 24 * HOUR, 'done'),
      item(
        'w6',
        'Added the webhook_events idempotency table and migration',
        'o8300',
        23 * HOUR,
        'done'
      ),
      item('w9', 'Opened the worker PR with tests', 'o31950', 110 * MIN, 'done'),
      item(
        'w12',
        'Backfill script for duplicated charges, dry-run only so far',
        'o33410',
        35 * MIN,
        'in-progress'
      ),
      item(
        'w13',
        'Load test against staging: no staging Stripe key in this environment',
        'o34120',
        30 * MIN,
        'blocked'
      )
    ],
    questions: [
      item(
        'q7',
        'Should the backfill refund duplicates automatically, or only list them for review?',
        'o33410',
        35 * MIN
      ),
      item(
        'q10',
        'Keep the old synchronous handler as a fallback for one release?',
        'o31950',
        110 * MIN
      )
    ],
    ignored: [
      item('i15', 'Log the Stripe event id on every job (asked, not done yet)', 'o15310', 21 * HOUR)
    ],
    actions: [
      item(
        't16',
        'Add STRIPE_STAGING_KEY to the staging secrets so the load test can run',
        'o34120',
        30 * MIN
      ),
      item('t17', 'Review the worker PR', 'o31950', 110 * MIN),
      item('t18', 'Tell support which customers were double-charged', 'o1480', 26 * HOUR)
    ],
    decisions: [
      item(
        'd19',
        'Idempotency key is the Stripe event id, not the payment intent',
        'o5210',
        25 * HOUR
      ),
      item('d20', 'Ship behind billing.queue_webhooks, off by default', 'o9120', 22 * HOUR)
    ],
    references: [
      {
        kind: 'pr',
        label: 'acme/billing#482',
        target: 'https://github.com/acme/billing/pull/482',
        messageId: 'o31950',
        at: SAMPLE_NOW - 110 * MIN
      },
      {
        kind: 'file',
        label: 'src/jobs/billing-webhook-worker.ts',
        target: '/code/billing/src/jobs/billing-webhook-worker.ts',
        messageId: 'o6020',
        at: SAMPLE_NOW - 24 * HOUR
      },
      {
        kind: 'file',
        label: 'db/migrations/0042_webhook_events.sql',
        target: '/code/billing/db/migrations/0042_webhook_events.sql',
        messageId: 'o8300',
        at: SAMPLE_NOW - 23 * HOUR
      },
      {
        kind: 'file',
        label: 'scripts/backfill-duplicate-charges.ts',
        target: '/code/billing/scripts/backfill-duplicate-charges.ts',
        messageId: 'o33410',
        at: SAMPLE_NOW - 35 * MIN
      },
      {
        kind: 'link',
        label: 'docs.stripe.com/webhooks#handle-duplicate-events',
        target: 'https://docs.stripe.com/webhooks#handle-duplicate-events',
        messageId: 'o5210',
        at: SAMPLE_NOW - 25 * HOUR
      }
    ],
    coveredTo: 35_000,
    nextItemId: 21,
    ...patch
  }
}

/** The recap as the host hands it over; the previous visit was three hours ago. */
export function sampleRecapView(patch: Partial<SessionRecapView> = {}): SessionRecapView {
  return {
    sessionId: 'billing',
    recap: sampleSessionRecap(),
    marks: { t18: 'done' },
    since: SAMPLE_NOW - 3 * HOUR,
    state: 'ready',
    stale: false,
    pausedUntil: null,
    failure: null,
    rev: 12,
    ...patch
  }
}

export const SAMPLE_RECAP_BRIEF: LiveSessionRecapBrief = {
  title: 'Move billing webhooks to the queue',
  rev: 12,
  questions: 2,
  actions: 2
}

function message(
  offset: number,
  role: 'user' | 'assistant',
  text: string,
  agoMs: number
): NativeChatMessage {
  return {
    id: `o${offset}`,
    role,
    source: 'transcript',
    timestamp: SAMPLE_NOW - agoMs,
    transcriptOffset: offset,
    blocks: [{ type: 'text', text }]
  }
}

/** The end of the conversation the sample recap was written from. */
export const SAMPLE_RECAP_TRANSCRIPT: NativeChatMessage[] = [
  message(30870, 'user', 'Open a PR for the worker and keep the backfill separate.', 2 * HOUR),
  message(
    31950,
    'assistant',
    'Opened https://github.com/acme/billing/pull/482 with the worker, the idempotency table and tests. It is ready for your review.\n\nOne thing to decide: do you want to keep the old synchronous handler as a fallback for one release?',
    110 * MIN
  ),
  message(32600, 'user', 'Carry on with the backfill while I look.', 40 * MIN),
  message(
    33410,
    'assistant',
    'The backfill script is written in `scripts/backfill-duplicate-charges.ts`. A dry run against production data finds 37 duplicated charges across 31 customers.\n\nBefore it does anything real: should it refund the duplicates automatically, or only list them for review?',
    35 * MIN
  ),
  message(
    34120,
    'assistant',
    'I could not run the load test against staging: there is no staging Stripe key in this environment. Add `STRIPE_STAGING_KEY` to the staging secrets and I will run it.',
    30 * MIN
  )
]
