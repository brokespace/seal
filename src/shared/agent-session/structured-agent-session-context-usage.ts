// Turn rows persist context facts across restart; writes target open/newest turns and replace their namesake, so newest facts win.

import {
  contextTokensFromUsage,
  type AgentSessionContextReport,
  type AgentSessionContextUsage,
  type AgentSessionContextUsageCategory,
  type AgentSessionContextUsed,
  type AgentSessionContextWindow
} from './agent-session-context-usage'
import type { AgentJournalRenderItem } from './journal/agent-session-journal-types'
import type { AgentSessionOptionsResult } from './options/protocol/agent-session-options-result'
import { readAgentJournalTurn } from './lifecycle/records/agent-session-turn-record'
import {
  isAgentSessionContextClear,
  latestAgentSessionContextClearSequence
} from './agent-session-context-clear'

export type StructuredAgentContextUsage = {
  usedTokens: number
  windowTokens: number
  /** Rounded and unclamped, so an over-limit session reads above 100. */
  percentage: number
  /** True when the count comes from the last response rather than a report. */
  estimated: boolean
  /** The provider's breakdown; empty for an estimate. */
  categories: readonly AgentSessionContextUsageCategory[]
  /** Where the provider compacts on its own, from its newest report for this window. */
  autoCompactAtTokens?: number
  model?: string
  /** Epoch ms the count was captured. */
  updatedAt?: number
  /** Compaction notices in the journal; absent unless its whole history was read. */
  compactions?: number
  /** Epoch ms of the newest compaction notice read. */
  lastCompactedAt?: number
}

/** A provider that names no model writes this in the report's place. */
const UNNAMED_MODEL = 'unknown'

type ContextFactSource = Pick<AgentJournalRenderItem, 'sequence' | 'body'>

/** Resolve each newest fact independently in any iteration order; missing parts stay absent. */
export function latestStructuredAgentContextFacts(
  items: Iterable<ContextFactSource>,
  minimumSequence = 0
): AgentSessionContextUsage {
  let used: { sequence: number; fact: AgentSessionContextUsed } | null = null
  let window: { sequence: number; fact: AgentSessionContextWindow } | null = null
  for (const item of items) {
    if (isAgentSessionContextClear(item.body) && item.sequence > minimumSequence) {
      minimumSequence = item.sequence
      if (used && used.sequence <= minimumSequence) {
        used = null
      }
      if (window && window.sequence <= minimumSequence) {
        window = null
      }
    }
    if (item.sequence <= minimumSequence) {
      continue
    }
    const facts = readAgentJournalTurn(item.body)?.contextUsage
    if (facts?.used && (used === null || item.sequence >= used.sequence)) {
      used = { sequence: item.sequence, fact: facts.used }
    }
    if (facts?.window && (window === null || item.sequence >= window.sequence)) {
      window = { sequence: item.sequence, fact: facts.window }
    }
  }
  return { ...(used ? { used: used.fact } : {}), ...(window ? { window: window.fact } : {}) }
}

/** Loaded rows reach the live head and outrank wholeJournal; use the host answer only for missing parts from older rows. */
export function selectStructuredAgentContextUsage(
  items: readonly AgentJournalRenderItem[],
  wholeJournal?: AgentSessionContextUsage,
  minimumSequence = 0
): StructuredAgentContextUsage | null {
  const clearedSequence = latestAgentSessionContextClearSequence(items)
  const floor = Math.max(minimumSequence, clearedSequence)
  const loaded = latestStructuredAgentContextFacts(items, floor)
  const fallback = clearedSequence > minimumSequence ? undefined : wholeJournal
  return summarizeStructuredAgentContextFacts(
    { ...fallback, ...loaded },
    latestContextReport(items, floor) ??
      (fallback?.used?.kind === 'report' ? { report: fallback.used, modelCurrent: false } : null)
  )
}

type HeldContextReport = {
  report: AgentSessionContextReport
  /** No reset since: an `unknown` after it may be a model change, which keeps the window's size. */
  modelCurrent: boolean
}

/** Between reports the count is an estimate, but the newest report still says where its window compacts. */
function latestContextReport(
  items: Iterable<ContextFactSource>,
  minimumSequence: number
): HeldContextReport | null {
  let latest: { sequence: number; report: AgentSessionContextReport } | null = null
  let resetSequence = 0
  for (const item of items) {
    const used = readAgentJournalTurn(item.body)?.contextUsage?.used
    if (item.sequence <= minimumSequence) {
      continue
    }
    if (used?.kind === 'unknown') {
      resetSequence = Math.max(resetSequence, item.sequence)
    }
    if (used?.kind === 'report' && (latest === null || item.sequence >= latest.sequence)) {
      latest = { sequence: item.sequence, report: used }
    }
  }
  return latest ? { report: latest.report, modelCurrent: resetSequence < latest.sequence } : null
}

export type StructuredAgentSessionCompactions = {
  /** Absent when older rows are not loaded, so the loaded count would run short. */
  compactions?: number
  lastCompactedAt?: number
}

/** Compaction notices since the conversation last started over; `complete` says the rows reach the journal's start. */
export function structuredAgentSessionCompactions(
  items: readonly Pick<AgentJournalRenderItem, 'sequence' | 'observedAt' | 'body'>[],
  complete = false
): StructuredAgentSessionCompactions {
  const clearedSequence = latestAgentSessionContextClearSequence(items)
  let count = 0
  let lastCompactedAt: number | undefined
  for (const item of items) {
    if (
      item.sequence <= clearedSequence ||
      item.body.kind !== 'status' ||
      item.body.presentation !== 'compaction'
    ) {
      continue
    }
    count += 1
    lastCompactedAt = Math.max(lastCompactedAt ?? 0, item.observedAt)
  }
  return {
    // Rows after a loaded clear are all loaded, whatever lies before it.
    ...(complete || clearedSequence > 0 ? { compactions: count } : {}),
    ...(lastCompactedAt === undefined ? {} : { lastCompactedAt })
  }
}

/**
 * A host that wrote a fact supplies usage. A reading can land just after a turn settles (Claude asks
 * for its report then), so one settled turn without a fact proves nothing; a second does.
 */
function awaitsContextFacts(
  items: readonly AgentJournalRenderItem[],
  held: AgentSessionContextUsage
): boolean {
  if (held.used || held.window) {
    return true
  }
  let settled = 0
  for (const item of items) {
    const turn = readAgentJournalTurn(item.body)
    if (turn?.contextUsage) {
      return true
    }
    if (turn && turn.state !== 'running') {
      settled += 1
    }
  }
  return settled < 2
}

/**
 * Fill missing loaded-window facts from the host's whole-journal answer; a floor from another epoch is ignored.
 * A session whose host writes context facts but has none to show yet gets an unmeasured answer (no
 * window), so its ring draws empty instead of disappearing. Null where the agent supplies none.
 */
export function selectStructuredAgentSessionContextUsage(
  journalItems: readonly AgentJournalRenderItem[],
  support: AgentSessionOptionsResult['contextUsage'],
  journalEpoch?: string | null,
  historyComplete = false
): StructuredAgentContextUsage | null {
  const usage = selectStructuredAgentContextUsage(
    journalItems,
    support?.current,
    support?.contextFloor && (!journalEpoch || support.contextFloor.epoch === journalEpoch)
      ? support.contextFloor.sequence
      : 0
  )
  const compactions = structuredAgentSessionCompactions(journalItems, historyComplete)
  if (usage) {
    return { ...usage, ...compactions }
  }
  if (
    !support ||
    (compactions.lastCompactedAt === undefined &&
      !awaitsContextFacts(journalItems, support.current))
  ) {
    return null
  }
  return {
    usedTokens: 0,
    windowTokens: 0,
    percentage: 0,
    estimated: false,
    categories: [],
    ...compactions
  }
}

function summarizeStructuredAgentContextFacts(
  { used: fact, window }: AgentSessionContextUsage,
  held: HeldContextReport | null
): StructuredAgentContextUsage | null {
  if (fact?.kind === 'report') {
    return {
      usedTokens: fact.usedTokens,
      windowTokens: fact.windowTokens,
      percentage: fact.percentage,
      estimated: false,
      categories: fact.categories,
      updatedAt: fact.capturedAt,
      ...reportedCompactionPoint({ report: fact, modelCurrent: true }, fact.windowTokens)
    }
  }
  // `unknown`, or a kind a newer host writes that this client cannot measure.
  if (fact?.kind !== 'estimate') {
    return null
  }
  // The writer holds estimates back across a model change, so the newest window is this model's.
  if (!window) {
    return null
  }
  const usedTokens = contextTokensFromUsage(fact.usage)
  return {
    usedTokens,
    windowTokens: window.tokens,
    percentage: Math.round((usedTokens / window.tokens) * 100),
    estimated: true,
    categories: [],
    updatedAt: fact.capturedAt,
    ...(held ? reportedCompactionPoint(held, window.tokens) : {})
  }
}

/** A report speaks for its own window only: another model compacts elsewhere. */
function reportedCompactionPoint(
  { report, modelCurrent }: HeldContextReport,
  windowTokens: number
): Pick<StructuredAgentContextUsage, 'autoCompactAtTokens' | 'model'> {
  if (report.windowTokens !== windowTokens) {
    return {}
  }
  return {
    ...(report.autoCompactAtTokens !== undefined && report.autoCompactAtTokens > 0
      ? { autoCompactAtTokens: report.autoCompactAtTokens }
      : {}),
    ...(modelCurrent && report.model !== UNNAMED_MODEL ? { model: report.model } : {})
  }
}
