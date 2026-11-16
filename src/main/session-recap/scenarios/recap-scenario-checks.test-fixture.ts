// Whether a recap says what a scenario's check expects, and what it said instead.
import type { RecapItem, SessionRecapView } from '../../../shared/session-recap/session-recap-types'
import type { RecapScenarioCheck } from './recap-scenario-schema.test-fixture'

export type RecapCheckContext = {
  view: SessionRecapView
  /** Requests a model answered since the scenario began. */
  requests: number
  /** The model that answered the last request; null before any did. */
  lastModel: string | null
}

export type RecapCheckResult = {
  /** The label of the check step this belongs to. */
  label: string
  check: RecapScenarioCheck
  ok: boolean
  /** What the recap held where the check looked. */
  actual: string
}

const matches = (pattern: string, text: string): boolean => new RegExp(pattern, 'i').test(text)

function show(items: readonly RecapItem[]): string {
  return items.length === 0
    ? '(none)'
    : items.map((item) => (item.state ? `[${item.state}] ${item.text}` : item.text)).join(' | ')
}

function within(count: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || count >= min) && (max === undefined || count <= max)
}

function viewValue(
  view: SessionRecapView,
  field: string,
  lastModel: string | null
): string | boolean {
  switch (field) {
    case 'state':
      return view.state
    case 'stale':
      return view.stale
    case 'degraded':
      return view.recap?.degraded === true
    case 'failed':
      return view.failure !== null
    case 'partial':
      return (view.recap?.coveredFrom ?? 0) > 0
    case 'exists':
      return view.recap !== null
    default:
      return lastModel ?? ''
  }
}

export function evaluateRecapCheck(
  check: RecapScenarioCheck,
  { view, requests, lastModel }: RecapCheckContext
): { ok: boolean; actual: string } {
  if ('requests' in check) {
    return {
      ok: within(requests, check.requests.min, check.requests.max),
      actual: `${requests} requests`
    }
  }
  if ('view' in check) {
    const value = viewValue(view, check.view, lastModel)
    return { ok: value === check.is, actual: String(value) }
  }
  if ('text' in check) {
    const value = view.recap?.[check.text] ?? ''
    return {
      ok:
        (check.has === undefined || matches(check.has, value)) &&
        (check.lacks === undefined || !matches(check.lacks, value)),
      actual: value || '(none)'
    }
  }
  const items = view.recap?.[check.in] ?? []
  const { has, lacks, state } = check
  const found = has === undefined ? [] : items.filter((item) => matches(has, item.text))
  const ok =
    (has === undefined ||
      found.some((item) => state === undefined || (item.state ?? 'done') === state)) &&
    (lacks === undefined || !items.some((item) => matches(lacks, item.text))) &&
    within(items.length, check.min, check.max)
  return { ok, actual: show(items) }
}
