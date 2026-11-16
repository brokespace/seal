// The recap regression suite: every scenario under `__fixtures__/scenarios`, run through the real recap
// pipeline on recorded model replies. See docs/recap-audit/README.md for recording and reporting.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CloudflareAiConfigStore } from '../../utility-model/cloudflare-ai-config'
import type { CloudflareAiCredentials } from '../../utility-model/cloudflare-workers-ai-provider'
import {
  addToRecapCassette,
  loadRecapBaseline,
  loadRecapCassette,
  loadRecapScenarios,
  mergeRelayedRecapReplies,
  saveRecapBaseline,
  writeRecapScenarioJson,
  type RecapBaseline
} from './recap-scenario-files.test-fixture'
import {
  RecapScenarioModel,
  type RecapCassetteEntry,
  type RecapPendingRequest
} from './recap-scenario-model.test-fixture'
import {
  failingRecapChecks,
  recapCategoryCounts,
  recapMatrixMarkdown,
  recapMatrixRow,
  type RecapMatrixRow
} from './recap-scenario-report.test-fixture'
import { runRecapScenario } from './recap-scenario-runner.test-fixture'

const env = process.env
/** Unanswered requests are written here instead of failing the run, for someone to answer. */
const pendingPath = env.RECAP_SCENARIOS_PENDING
/** Replies to that file's requests, filed into the cassettes before the run. */
const repliesPath = env.RECAP_SCENARIOS_REPLIES
/** Ask the real model for what no recording answers, and record it. Needs the Cloudflare config file. */
const live = env.RECAP_SCENARIOS_LIVE === '1'
const reportDir = env.RECAP_SCENARIOS_REPORT
const updateBaseline = env.RECAP_SCENARIOS_UPDATE_BASELINE === '1'
/** Scenario ids, comma-separated: run only these. */
const only = env.RECAP_SCENARIOS_ONLY?.split(',')
const recording = pendingPath !== undefined || live || updateBaseline

const scenarios = (await loadRecapScenarios()).filter(
  (scenario) => !only || only.includes(scenario.id)
)
const baseline = await loadRecapBaseline()
const rows: RecapMatrixRow[] = []
const pending: RecapPendingRequest[] = []
const results: RecapBaseline = {}
let credentials: CloudflareAiCredentials | undefined

async function liveCredentials(): Promise<CloudflareAiCredentials> {
  const store = new CloudflareAiConfigStore({
    saved: {
      read: () => null,
      save: () => undefined,
      clear: () => undefined,
      protection: () => null
    }
  })
  const found = (await store.load()).credentials
  if (!found) {
    throw new Error('RECAP_SCENARIOS_LIVE needs ~/.config/seal/cloudflare-ai.json')
  }
  return found
}

describe('recap scenarios', () => {
  beforeAll(async () => {
    if (pendingPath && repliesPath) {
      await mergeRelayedRecapReplies(pendingPath, repliesPath)
    }
    if (live) {
      credentials = await liveCredentials()
    }
  })

  afterAll(async () => {
    if (pendingPath) {
      const unique = new Map(
        pending.map((request) => [`${request.scenario} ${request.key}`, request])
      )
      await writeFile(pendingPath, `${JSON.stringify([...unique.values()], null, 2)}\n`)
    }
    if (reportDir) {
      rows.sort((a, b) => a.id.localeCompare(b.id))
      await writeRecapScenarioJson(join(reportDir, 'matrix.json'), {
        counts: recapCategoryCounts(rows),
        runs: rows
      })
      await writeFile(join(reportDir, 'matrix.md'), recapMatrixMarkdown(rows))
    }
    if (updateBaseline && pending.length === 0) {
      await saveRecapBaseline(only ? { ...baseline, ...results } : results)
    }
  })

  for (const scenario of scenarios) {
    for (const surface of scenario.surfaces) {
      it(`${scenario.id}@${surface}: ${scenario.title}`, async () => {
        const recorded: RecapCassetteEntry[] = []
        const model = new RecapScenarioModel({
          scenario: scenario.id,
          cassette: await loadRecapCassette(scenario.id),
          ...(live
            ? {
                live: (url: string, init: RequestInit) => fetch(url, init),
                onRecorded: (entry: RecapCassetteEntry) => recorded.push(entry)
              }
            : {})
        })
        const run = await runRecapScenario(scenario, surface, model, credentials)
        if (recorded.length > 0) {
          await addToRecapCassette(scenario.id, recorded)
        }
        rows.push(recapMatrixRow(run))
        pending.push(...model.pending)
        results[run.id] = failingRecapChecks(run)
        if (recording) {
          return
        }
        // A request with no recorded reply means the prompt or the scenario changed: record it again.
        expect(model.pending.map((request) => request.key)).toEqual([])
        expect(failingRecapChecks(run)).toEqual(baseline[run.id] ?? [])
      })
    }
  }
})
