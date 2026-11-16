// The labelled suite judged by the recap's own code: the app's transcript readers, the conversation
// reader, the requests step, the Clef client and the display rule. Only the read step is left out:
// each labelled request goes in under the user's own words, as the measurement asked about it.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  recapRequestDisplay,
  recapTurnHasEnded,
  type RecapRequestDisplay
} from '../../../shared/session-recap/session-recap-request-display'
import { SessionSummaryCache } from '../../session-summaries/session-summary-cache'
import { UtilityModelError } from '../../utility-model/utility-model-provider'
import { createClefRecapJudge } from '../session-recap-clef-judge'
import { redactRecapCommand } from '../session-recap-command-redaction'
import { recapJudgeBody, recapJudgeKey, type RecapJudgeState } from '../session-recap-judge'
import { createRecapRequestsStep } from '../session-recap-requests'
import {
  recapJudgedItems,
  type RecapJudgedItem,
  type RecapLabels
} from './recap-judge-labels.test-fixture'
import type { RecapJudgeRecord } from './recap-judge-models.test-fixture'
import { recapJudgeState } from './recap-judge-state.test-fixture'
import {
  recapScenarioSteps,
  type RecapScenario,
  type RecapScenarioSurface
} from './recap-scenario-schema.test-fixture'
import {
  RECAP_SCENARIO_START,
  RECAP_SCENARIO_STEP_MS,
  recapScenarioSession,
  recapScenarioTranscripts
} from './recap-scenario-session.test-fixture'

export type RecapProductJudgement = {
  item: RecapJudgedItem
  surface: RecapScenarioSurface
  /** What the recap would show for the request at this check. */
  display: RecapRequestDisplay
  /** The state the recap's reader built is the one the measurement asked about, byte for byte. */
  sameState: boolean
  /** The judge had an answer on record for what the recap asked. */
  answered: boolean
}

export async function judgeLabelledScenario(
  scenario: RecapScenario,
  labels: RecapLabels,
  surface: RecapScenarioSurface,
  recorded: ReadonlyMap<string, RecapJudgeRecord>
): Promise<RecapProductJudgement[]> {
  const opened = recapScenarioSession(surface, await mkdtemp(join(tmpdir(), 'seal-recap-judge-')))
  let { session } = opened
  const conversation =
    opened.journal?.conversation ??
    opened.fileConversation(opened.transcriptPath, session.providerSessionId)
  const transcripts = recapScenarioTranscripts(() => session, opened.journal)
  let now = RECAP_SCENARIO_START
  let asked: RecapJudgeState | null = null
  const judge = createClefRecapJudge({
    decide: async (model, request) => {
      const record = recorded.get(recapJudgeKey(model, request.body))
      if (!record) {
        throw new UtilityModelError('network', 'No answer on record')
      }
      return {
        answers: Object.fromEntries(
          Object.entries(record.answers).map(([id, noul]) => [id, { noul }])
        ),
        inputTokens: record.inputTokens
      }
    },
    cache: new SessionSummaryCache(null),
    spend: () => undefined,
    record: () => undefined,
    now: () => now
  })
  const settle = createRecapRequestsStep({
    judge: {
      ...judge,
      ask: (state, signal) => {
        asked = state
        return judge.ask(state, signal)
      }
    },
    since: (id, cursor) => transcripts.of(id).since(cursor),
    turnEnded: () => recapTurnHasEnded(session.status),
    allows: () => true,
    redact: redactRecapCommand,
    now: () => now
  })
  const items = recapJudgedItems(scenario, labels)
  const judgements: RecapProductJudgement[] = []
  const setStatus = (status: typeof session.status): void => {
    session = { ...session, status }
    opened.journal?.setWorking(status === 'working')
  }
  for (const step of recapScenarioSteps(scenario)) {
    if (!('check' in step)) {
      now += RECAP_SCENARIO_STEP_MS
      await conversation.write(step, now)
      if ('status' in step) {
        setStatus(step.status)
      } else if ('user' in step && session.status !== 'working') {
        setStatus('working')
      }
      continue
    }
    const read = await transcripts.of(session.id).since(0)
    for (const item of items.filter((found) => found.id.endsWith(`@${step.label}`))) {
      const message = read.messages.find(
        (found) =>
          found.role === 'user' &&
          found.blocks.some((block) => block.type === 'text' && block.text.includes(item.request))
      )
      asked = null
      const [request] = await settle({
        sessionId: session.id,
        kind: 'auto',
        before: [],
        asked: [{ id: 'a1', text: item.request, messageId: message?.id ?? null, at: now }],
        messages: read.messages,
        coveredTo: read.cursor,
        signal: new AbortController().signal
      })
      judgements.push({
        item,
        surface,
        display: recapRequestDisplay(request, {
          coveredTo: read.cursor,
          turnEnded: recapTurnHasEnded(session.status),
          stale: false
        }),
        sameState: JSON.stringify(asked) === JSON.stringify(recapJudgeState(item)),
        answered:
          asked !== null &&
          recorded.has(
            recapJudgeKey(judge.calibration.model, recapJudgeBody(judge.calibration.model, asked))
          )
      })
    }
  }
  return judgements
}
