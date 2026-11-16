// The scripted `claude` that serves both the utility model (summaries, reply-ask, recaps) and structured chats.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import type { LiveSession } from '../../../src/shared/live-sessions/live-session-types'
import type { SessionSummariesStatus } from '../../../src/shared/session-summaries/session-summary-contracts'
import { buildFakeAgentCommandOverride } from './fake-agent-command-override'
import { callLocalRuntime, readLiveSessions } from './live-session-registry'
import { expect } from './orca-app'
import {
  openStubChat,
  SUPPORTED,
  test as structuredClaudeTest,
  type ClaudeStub
} from './structured-claude-stub'
import { waitForActiveWorktree, waitForSessionReady } from './store'

export { expect, SUPPORTED }

const STUB_SCRIPT = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'session-services-claude-stub.cjs'
)

export type SessionServicesStub = ClaudeStub & {
  /** One JSON line per utility-model request the stub answered. */
  utilityLog: string
  /** Written by `writeSessionServicesScript`; the stub reads it on every request. */
  scriptFile: string
}

/** What the stub answers; every field left out keeps the default in the fixture script. */
export type SessionServicesScript = {
  summary?: string
  askingSummary?: string
  askMarker?: string
  recap?: Partial<
    Record<'title' | 'goal' | 'standing' | 'asked' | 'did' | 'decision' | 'question', string>
  >
  /** Recorded model replies: the first entry whose `match` a recap prompt contains answers it verbatim. */
  recapReplies?: { match: string; reply: string }[]
  /** Every recap request fails with this on stderr. */
  recapFailure?: string
  chatTitle?: string
  chat?: { replies?: { match: string; reply: string }[]; defaultReply?: string }
}

export type UtilityRequestKind =
  | 'summary'
  | 'summary-asking'
  | 'reply-ask'
  | 'recap'
  | 'chat-title'
  | 'unknown'

export type UtilityRequestRecord = {
  pid: number
  kind: UtilityRequestKind
  args: string[]
  cwd: string
  prompt: string
  reply: string
  failure?: string
}

/** The stub's defaults, for specs that assert on what a row or a recap shows. */
export const SCRIPTED = {
  summary: 'Scripted summary: fixed the login redirect.',
  askingSummary: 'Scripted summary: needs your pick between two options.',
  askMarker: 'should I go ahead',
  recapTitle: 'Login redirect fix',
  recapGoal: 'Scripted goal: stop the login page redirecting in a loop.',
  recapStanding: 'Scripted standing: the redirect is fixed and covered by a test.',
  recapAsked: 'Scripted ask: fix the login redirect loop',
  recapDid: 'Scripted work: fixed the login redirect and added a test',
  recapDecision: 'Scripted decision: keep the session check on the server',
  recapQuestion: 'Scripted question: which of the two options to go ahead with',
  chatTitle: 'Login redirect chat',
  /** A chat prompt holding this ends the turn on `chatAskReply`: a question with no question mark. */
  chatAskPrompt: 'ask-me',
  chatAskReply: 'I looked at both options. Tell me which one you want and should I go ahead',
  chatDefaultReply: 'Fixed the login redirect and added a test.'
} as const

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * The structured-chat fixture with its `claude` wrapper pointed at the session-services stub, so
 * the PATH isolation and the shadowing check stay the ones that fixture owns.
 */
export const test = structuredClaudeTest.extend<{ sessionServicesStub: SessionServicesStub }>({
  claudeStub: async ({ claudeStub }, provideFixture) => {
    writeFileSync(
      claudeStub.command,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(STUB_SCRIPT)} ${quote(claudeStub.launchLog)} "$@"\n`
    )
    chmodSync(claudeStub.command, 0o755)
    await provideFixture(claudeStub)
  },
  sessionServicesStub: async ({ claudeStub }, provideFixture) => {
    await provideFixture({
      ...claudeStub,
      utilityLog: `${claudeStub.launchLog}.utility.jsonl`,
      scriptFile: path.join(path.dirname(claudeStub.launchLog), 'session-services-script.json')
    })
  }
})

/** Replaces the stub's script; `{}` goes back to the defaults. */
export function writeSessionServicesScript(
  stub: SessionServicesStub,
  script: SessionServicesScript
): void {
  writeFileSync(stub.scriptFile, JSON.stringify(script))
}

export function readUtilityRequests(
  stub: SessionServicesStub,
  kind?: UtilityRequestKind
): UtilityRequestRecord[] {
  if (!existsSync(stub.utilityLog)) {
    return []
  }
  return readFileSync(stub.utilityLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line): UtilityRequestRecord => JSON.parse(line))
    .filter((record) => !kind || record.kind === kind)
}

/**
 * Points Seal at the stub: chats and the `claude` CLI run it, and summaries, the reply-ask
 * classifier and recaps run on the `claude` utility provider, which is that same command.
 */
export async function useScriptedSessionServices(
  page: Page,
  stub: Pick<ClaudeStub, 'command'>
): Promise<void> {
  await waitForSessionReady(page)
  await page.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      nativeChatProviders: { claude: true, codex: true },
      defaultTuiAgent: 'claude',
      agentCmdOverrides: { claude: command },
      sessionSummaryModels: {
        summaries: { provider: 'claude', model: null, fallbackModel: null },
        recaps: null
      },
      sessionSummariesEnabled: true,
      sessionRecapEnabled: true
    })
  }, buildFakeAgentCommandOverride(stub.command))
  // The host re-reads which provider is configured on the settings change; requests wait on it.
  await expect
    .poll(
      async () => {
        const status = await callLocalRuntime<SessionSummariesStatus>(
          page,
          'sessionSummaries.status'
        )
        return {
          provider: status.models?.summaries.provider,
          configured: status.configured,
          recapConfigured: status.recapConfigured
        }
      },
      { timeout: 30_000, message: 'the claude utility provider was not detected as installed' }
    )
    .toEqual({ provider: 'claude', configured: true, recapConfigured: true })
}

export type StubChat = {
  /** The structured session id (`agentSession.create`). */
  sessionId: string
  worktreeId: string
  tab: Locator
  composer: Locator
  send: Locator
  stop: Locator
  /** The chat's root, for asserting on a scripted reply: `chat.root.getByText(SCRIPTED.chatDefaultReply)`. */
  root: Locator
}

/** Opens a chat tab on the stub (the existing `openStubChat`) and names the session it made. */
export async function startStubChat(
  page: Page,
  stub: Pick<ClaudeStub, 'command'>
): Promise<StubChat> {
  const worktreeId = await waitForActiveWorktree(page)
  const chat = await openStubChat(page, stub.command)
  const tabId = await chat.tab.getAttribute('data-tab-id')
  const sessionId = await page.evaluate(
    ({ worktreeId, tabId }) =>
      window.__store?.getState().unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)
        ?.entityId ?? null,
    { worktreeId, tabId }
  )
  if (!sessionId) {
    throw new Error(`The stub chat tab ${tabId} names no session`)
  }
  return {
    sessionId,
    worktreeId,
    tab: chat.tab,
    composer: chat.composer,
    send: chat.send,
    stop: chat.stop,
    root: page.locator('[data-native-chat-root="true"]')
  }
}

/** Sends one prompt; the stub answers by the first scripted `match` the prompt contains. */
export async function sendStubChatPrompt(chat: StubChat, prompt: string): Promise<void> {
  await chat.composer.click()
  await chat.composer.pressSequentially(prompt)
  // Enter, not the Send button: a toast (the Claude theme offer a pane session raises) can cover it.
  await chat.composer.press('Enter')
}

/**
 * The registry's session for a stub chat; null until the chat's first turn. Its id is
 * `local:claude:<the id the stub announced>`, which only the chat's pane route ties to the chat.
 */
export async function readStubChatLiveSession(
  page: Page,
  chat: Pick<StubChat, 'sessionId'>
): Promise<LiveSession | null> {
  const panePrefix = `structured-agent-session-${chat.sessionId}:`
  return (
    (await readLiveSessions(page)).find((session) =>
      session.inputRoutes.some(
        (route) => route.kind === 'seal-pane' && route.paneKey.startsWith(panePrefix)
      )
    ) ?? null
  )
}
