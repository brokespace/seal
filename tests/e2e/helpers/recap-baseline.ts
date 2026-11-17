// What the recap baseline specs share: the recorded model replies they replay and the evidence they save.
// The scenarios and cassettes are the ones the pipeline suite runs (src/main/session-recap/scenarios).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page, type TestInfo } from '@stablyai/playwright-test'
import { evaluateRecapCheck } from '../../../src/main/session-recap/scenarios/recap-scenario-checks.test-fixture'
import {
  recapScenarioSchema,
  type RecapScenarioCheck
} from '../../../src/main/session-recap/scenarios/recap-scenario-schema.test-fixture'
import {
  RECAP_SECTIONS,
  type RecapSection,
  type SessionRecapView
} from '../../../src/shared/session-recap/session-recap-types'
import { readSessionRecap } from './live-session-registry'
import {
  readUtilityRequests,
  type SessionServicesStub,
  type UtilityRequestRecord
} from './session-services-stub'

const FIXTURES = path.join(
  process.cwd(),
  'src',
  'main',
  'session-recap',
  'scenarios',
  '__fixtures__'
)

/** The specs wait out the recap scheduler's real intervals (minutes), so they run only when asked for. */
export const RECAP_BASELINE_ENABLED = process.env.RECAP_E2E === '1'

export type RecapCassetteEntry = { messages: { role: string; content: string }[]; reply: string }

export type RecapScenarioStep = Record<string, unknown>

/** One scenario of the pipeline suite, for a spec to drive the app with the same words. */
export function readRecapScenario(id: string): { id: string; steps: RecapScenarioStep[] } {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'scenarios', `${id}.json`), 'utf8'))
}

/** Every request of a scenario's pipeline run with the real model's reply to it. */
export function recordedRecapCassette(scenarioId: string): RecapCassetteEntry[] {
  try {
    return JSON.parse(readFileSync(path.join(FIXTURES, 'cassettes', `${scenarioId}.json`), 'utf8'))
  } catch {
    // A scenario whose pipeline run asked the model nothing has no cassette.
    return []
  }
}

/**
 * The real model's recorded replies for a scenario, keyed by the new messages each request held,
 * so the scripted utility model answers the app's requests with what the real model said.
 */
export function recordedRecapReplies(scenarioId: string): { match: string; reply: string }[] {
  return recordedRecapCassette(scenarioId)
    .filter((entry) => entry.messages.length === 1)
    .map((entry) => {
      const content = entry.messages[0].content
      return { match: content.slice(content.indexOf('<new_messages>')), reply: entry.reply }
    })
}

/** `RECAP_E2E_EVIDENCE_DIR/<test>/` when set (the audit's evidence folder), the test's output folder otherwise. */
export function recapEvidencePath(testInfo: TestInfo, file: string): string {
  const root = process.env.RECAP_E2E_EVIDENCE_DIR
  if (!root) {
    return testInfo.outputPath(file)
  }
  const dir = path.join(root, testInfo.title.replaceAll(/[^A-Za-z0-9]+/g, '-').slice(0, 80))
  mkdirSync(dir, { recursive: true })
  return path.join(dir, file)
}

/** A screenshot of the window, the recap as the panel reads it, and the recap requests made so far. */
export async function saveRecapEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  sessionId: string,
  stub?: SessionServicesStub
): Promise<SessionRecapView> {
  await page.screenshot({ path: recapEvidencePath(testInfo, `${name}.png`) })
  const view = await readSessionRecap(page, sessionId)
  const requests = stub
    ? readUtilityRequests(stub, 'recap').map(({ prompt, reply, failure }) => ({
        newMessages: prompt.slice(prompt.lastIndexOf('<new_messages>')),
        reply,
        failure
      }))
    : undefined
  writeFileSync(
    recapEvidencePath(testInfo, `${name}.json`),
    `${JSON.stringify({ view, requests }, null, 2)}\n`
  )
  return view
}

/** Longer than the 4 minutes the scheduler leaves between two automatic passes. */
export const NEXT_AUTOMATIC_PASS_MS = 330_000

export type RecapPanelLists = Record<RecapSection, string[]>
export type RecapScenarioChecks = { label: string; check: RecapScenarioCheck[] }[]
/** What the user had in front of them at one point of a scenario. */
export type RecapCheckpoint = {
  label: string
  view: SessionRecapView
  requests: number
  panel?: RecapPanelLists
}

/**
 * `recordedRecapReplies` plus the replies to repair requests, which go first: a repair still holds
 * the first request's messages, so only the earlier reply it quotes tells the two apart.
 */
export function recordedRecapRepliesWithRepairs(
  scenarioId: string
): { match: string; reply: string }[] {
  const repairs = recordedRecapCassette(scenarioId)
    .filter((entry) => entry.messages.length === 3)
    .map((entry) => ({
      match: `Your earlier reply:\n${entry.messages[1].content.trimEnd()}`,
      reply: entry.reply
    }))
  return [...repairs, ...recordedRecapReplies(scenarioId)]
}

/** Requests the app made that no recording answers: the run no longer replays the real model. */
export function unrecordedRecapRequests(
  requests: readonly UtilityRequestRecord[],
  recorded: readonly { reply: string }[]
): string[] {
  const replies = recorded.map((entry) => entry.reply)
  return requests
    .filter((request) => !replies.includes(request.reply))
    .map((request) => request.prompt.slice(request.prompt.lastIndexOf('<new_messages>')))
}

/** Waits for a pass that ended after `after` and left a recap covering the whole conversation. */
export async function waitForRecapPass(
  read: () => Promise<SessionRecapView>,
  after: number,
  timeout: number,
  rescan?: () => Promise<void>
): Promise<SessionRecapView> {
  let view: SessionRecapView | null = null
  await expect
    .poll(
      async () => {
        await rescan?.()
        view = await read()
        return (
          view.state === 'ready' &&
          !view.stale &&
          view.recap !== null &&
          view.recap.updatedAt > after
        )
      },
      { timeout, intervals: [1_000], message: 'no recap pass covered the conversation' }
    )
    .toBe(true)
  return view!
}

/** The user opens the session from its row and shows its recap panel. */
export async function openRecapPanel(page: Page, sessionId: string): Promise<Locator> {
  const pane = page.locator(`[data-live-session-pane="${sessionId}"]`)
  if (!(await pane.isVisible())) {
    await page.locator(`[data-live-session-row="${sessionId}"]`).first().click()
  }
  await expect(pane).toBeVisible()
  const toggle = pane.locator('[data-live-session-panel-toggle="recap"]')
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click()
  }
  const panel = pane.locator('[data-live-session-panel="recap"]')
  await expect(panel).toBeVisible()
  return panel
}

/** Where the panel draws each list the recap holds; requests carry what was asked and what was missed. */
const PANEL_ITEMS: Record<RecapSection, string> = {
  questions: '[data-recap-section="questions"] li',
  actions: '[data-recap-section="actions"] li',
  did: '[data-recap-section="did"] li',
  decisions: '[data-recap-section="decisions"] li',
  asked: '[data-recap-request] [data-recap-item-text]',
  ignored: '[data-recap-request-state="not-addressed"] [data-recap-item-text]'
}

/** One list of the recap as the panel draws it, each item by its words. */
export function recapPanelItems(panel: Locator, section: RecapSection): Locator {
  return panel.locator(PANEL_ITEMS[section])
}

/** Done, withdrawn and dismissed requests sit behind a count until the user unfolds them. */
export async function unfoldSettledRecapRequests(panel: Locator): Promise<void> {
  const fold = panel.locator('[data-recap-section="requests"] button[aria-expanded="false"]')
  if ((await fold.count()) > 0) {
    await fold.click()
  }
}

export async function readRecapPanelLists(panel: Locator): Promise<RecapPanelLists> {
  await unfoldSettledRecapRequests(panel)
  const entries = await Promise.all(
    RECAP_SECTIONS.map(async (section) => [
      section,
      await recapPanelItems(panel, section).allTextContents()
    ])
  )
  return Object.fromEntries(entries)
}

/** What a correct recap would hold at each checkpoint and does not, in the scenario's own words. */
export function failedRecapChecks(
  checkpoints: readonly RecapCheckpoint[],
  checks: RecapScenarioChecks
): string[] {
  return checks.flatMap(({ label, check }) => {
    const at = checkpoints.find((checkpoint) => checkpoint.label === label)
    if (!at) {
      return [`${label}: never reached`]
    }
    return check.flatMap((expected) => {
      const { ok, actual } = evaluateRecapCheck(expected, {
        view: at.view,
        requests: at.requests,
        lastModel: null
      })
      return ok ? [] : [`${label}: ${expected.why} (was: ${actual})`]
    })
  })
}

/** Where the panel lists something else than the recap it was given. */
export function recapPanelMismatches(checkpoints: readonly RecapCheckpoint[]): string[] {
  return checkpoints.flatMap(({ label, view, panel }) =>
    panel
      ? RECAP_SECTIONS.flatMap((section) => {
          const held = (view.recap?.[section] ?? []).map((item) => item.text).toSorted()
          const shown = panel[section].toSorted()
          return JSON.stringify(held) === JSON.stringify(shown)
            ? []
            : [`${label}: the panel lists ${JSON.stringify(shown)} under ${section}`]
        })
      : []
  )
}

export type RecapScenarioTurn = { user: string; edits: string[]; agent: string }

/** A scenario as plain turns, for a surface that needs only what each side said and which files changed. */
export function readRecapScenarioTurns(id: string): {
  turns: RecapScenarioTurn[]
  checks: RecapScenarioChecks
} {
  const { steps } = recapScenarioSchema.parse(readRecapScenario(id))
  const turns: RecapScenarioTurn[] = []
  const checks: RecapScenarioChecks = []
  for (const step of steps) {
    const turn = turns.at(-1)
    if ('user' in step) {
      turns.push({ user: step.user, edits: [], agent: '' })
    } else if ('edit' in step) {
      turn?.edits.push(step.edit)
    } else if ('agent' in step && turn) {
      turn.agent = step.agent
    } else if ('check' in step) {
      checks.push(step)
    }
  }
  return { turns, checks }
}

export function saveRecapEvidenceJson(testInfo: TestInfo, name: string, value: unknown): void {
  writeFileSync(recapEvidencePath(testInfo, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
}

/** The user opens the recap: a screenshot, the view, and what the panel lists, before anything is asserted. */
export async function captureRecapCheckpoint(
  page: Page,
  testInfo: TestInfo,
  stub: SessionServicesStub,
  sessionId: string,
  name: string,
  label: string
): Promise<RecapCheckpoint> {
  const panel = await openRecapPanel(page, sessionId)
  await expect(panel.locator('[data-recap-section], [data-recap-note]').first()).toBeVisible()
  const requests = panel.locator('[data-recap-section="requests"]')
  if ((await requests.count()) > 0) {
    await requests.scrollIntoViewIfNeeded()
  }
  const view = await saveRecapEvidence(page, testInfo, name, sessionId, stub)
  return {
    label,
    view,
    requests: readUtilityRequests(stub, 'recap').length,
    panel: await readRecapPanelLists(panel)
  }
}
