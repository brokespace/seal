// What the recap baseline specs share: the recorded model replies they replay and the evidence they save.
// The scenarios and cassettes are the ones the pipeline suite runs (src/main/session-recap/scenarios).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import type { SessionRecapView } from '../../../src/shared/session-recap/session-recap-types'
import { readSessionRecap } from './live-session-registry'
import { readUtilityRequests, type SessionServicesStub } from './session-services-stub'

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

type CassetteEntry = { messages: { role: string; content: string }[]; reply: string }

export type RecapScenarioStep = Record<string, unknown>

/** One scenario of the pipeline suite, for a spec to drive the app with the same words. */
export function readRecapScenario(id: string): { id: string; steps: RecapScenarioStep[] } {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'scenarios', `${id}.json`), 'utf8'))
}

/**
 * The real model's recorded replies for a scenario, keyed by the new messages each request held,
 * so the scripted utility model answers the app's requests with what the real model said.
 */
export function recordedRecapReplies(scenarioId: string): { match: string; reply: string }[] {
  const entries: CassetteEntry[] = JSON.parse(
    readFileSync(path.join(FIXTURES, 'cassettes', `${scenarioId}.json`), 'utf8')
  )
  return entries
    .filter((entry) => entry.messages.length === 1)
    .map((entry) => {
      const content = entry.messages[0].content
      return { match: content.slice(content.indexOf('<new_messages>')), reply: entry.reply }
    })
}

/** `RECAP_E2E_EVIDENCE_DIR/<test>/` when set (the audit's evidence folder), the test's output folder otherwise. */
function evidencePath(testInfo: TestInfo, file: string): string {
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
  await page.screenshot({ path: evidencePath(testInfo, `${name}.png`) })
  const view = await readSessionRecap(page, sessionId)
  const requests = stub
    ? readUtilityRequests(stub, 'recap').map(({ prompt, reply, failure }) => ({
        newMessages: prompt.slice(prompt.lastIndexOf('<new_messages>')),
        reply,
        failure
      }))
    : undefined
  writeFileSync(
    evidencePath(testInfo, `${name}.json`),
    `${JSON.stringify({ view, requests }, null, 2)}\n`
  )
  return view
}
