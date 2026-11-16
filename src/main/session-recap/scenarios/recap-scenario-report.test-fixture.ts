// The scenario matrix as the audit publishes it: every run's expected and actual recap, and counts by category.
import {
  RECAP_SECTIONS,
  type SessionRecap
} from '../../../shared/session-recap/session-recap-types'
import type { RecapCheckResult } from './recap-scenario-checks.test-fixture'
import type { RecapScenarioRun } from './recap-scenario-runner.test-fixture'
import {
  RECAP_SCENARIO_CATEGORIES,
  type RecapScenarioCategory
} from './recap-scenario-schema.test-fixture'

/** How the baseline and the matrix name a check: where it sits and what it protects. */
export function recapCheckName(result: Pick<RecapCheckResult, 'label' | 'check'>): string {
  return `${result.label}: ${result.check.why}`
}

export function failingRecapChecks(run: RecapScenarioRun): string[] {
  return run.checks.filter((check) => !check.ok).map(recapCheckName)
}

export type RecapMatrixRow = {
  id: string
  title: string
  categories: RecapScenarioCategory[]
  surface: string
  status: RecapScenarioRun['status']
  expected: string
  passes: string[]
  requests: number
  state: string
  stale: boolean
  failure: string | null
  recap: Pick<SessionRecap, 'title' | 'goal' | 'standing' | 'degraded'> &
    Record<(typeof RECAP_SECTIONS)[number], string[]>
  checks: { name: string; ok: boolean; actual: string }[]
}

function recapOf(run: RecapScenarioRun): RecapMatrixRow['recap'] {
  const recap = run.view.recap
  const section = (name: (typeof RECAP_SECTIONS)[number]): string[] =>
    (recap?.[name] ?? []).map((item) => (item.state ? `[${item.state}] ${item.text}` : item.text))
  return {
    title: recap?.title ?? null,
    goal: recap?.goal ?? null,
    standing: recap?.standing ?? null,
    ...(recap?.degraded ? { degraded: true as const } : {}),
    asked: section('asked'),
    did: section('did'),
    questions: section('questions'),
    ignored: section('ignored'),
    actions: section('actions'),
    decisions: section('decisions')
  }
}

export function recapMatrixRow(run: RecapScenarioRun): RecapMatrixRow {
  return {
    id: run.id,
    title: run.scenario.title,
    categories: run.scenario.categories,
    surface: run.surface,
    status: run.status,
    expected: run.scenario.expected,
    passes: run.passes,
    requests: run.requests,
    state: run.view.state,
    stale: run.view.stale,
    failure: run.view.failure,
    recap: recapOf(run),
    checks: run.checks.map((check) => ({
      name: recapCheckName(check),
      ok: check.ok,
      actual: check.actual
    }))
  }
}

export type RecapCategoryCount = { category: RecapScenarioCategory; pass: number; fail: number }

/** Runs by category; a run in two categories counts in both. */
export function recapCategoryCounts(rows: readonly RecapMatrixRow[]): RecapCategoryCount[] {
  return RECAP_SCENARIO_CATEGORIES.map((category) => {
    const inCategory = rows.filter((row) => row.categories.includes(category))
    return {
      category,
      pass: inCategory.filter((row) => row.status === 'pass').length,
      fail: inCategory.filter((row) => row.status !== 'pass').length
    }
  }).filter((count) => count.pass + count.fail > 0)
}

const cell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

function actualOf(row: RecapMatrixRow): string {
  const parts = [
    `state ${row.state}${row.stale ? ', stale' : ''}${row.recap.degraded ? ', degraded' : ''}`,
    row.recap.standing ? `standing: ${row.recap.standing}` : null,
    ...RECAP_SECTIONS.map((section) =>
      row.recap[section].length > 0 ? `${section}: ${row.recap[section].join('; ')}` : null
    )
  ]
  return parts.filter((part) => part !== null).join('<br>')
}

export function recapMatrixMarkdown(rows: readonly RecapMatrixRow[]): string {
  const counts = recapCategoryCounts(rows)
  const passed = rows.filter((row) => row.status === 'pass').length
  const lines = [
    '# Recap scenario matrix',
    '',
    `${rows.length} runs: ${passed} pass, ${rows.length - passed} fail.`,
    '',
    '## By category',
    '',
    '| Category | Pass | Fail |',
    '| --- | ---: | ---: |',
    ...counts.map((count) => `| ${count.category} | ${count.pass} | ${count.fail} |`),
    '',
    '## Runs',
    '',
    '| Run | Categories | Expected | Actual (final recap) | Result | Failing checks |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => {
      const failing = row.checks.filter((check) => !check.ok)
      return `| \`${row.id}\`<br>${cell(row.title)} | ${row.categories.join(', ')} | ${cell(row.expected)} | ${cell(actualOf(row))} | ${row.status.toUpperCase()} | ${
        failing.length === 0
          ? ''
          : failing.map((check) => cell(`${check.name} (was: ${check.actual})`)).join('<br>')
      } |`
    }),
    ''
  ]
  return lines.join('\n')
}
