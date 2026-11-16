// A chat that finished a turn shows the utility model's summary on its row, and its recap lists what was asked, done, decided and referenced.
import {
  readSessionRecap,
  rescanLiveSessions,
  waitForLiveSession
} from './helpers/live-session-registry'
import {
  expect,
  readStubChatLiveSession,
  readUtilityRequests,
  SCRIPTED,
  sendStubChatPrompt,
  startStubChat,
  SUPPORTED,
  test,
  useScriptedSessionServices,
  writeSessionServicesScript
} from './helpers/session-services-stub'

const PROMPT = 'Fix the login redirect loop'
// Over 80 characters, so the row's line has to come from the model; its link gives the recap a reference.
const CHAT_REPLY =
  'I traced the loop to the session check running before the cookie was read, moved it after, and added a regression test. Details are in https://github.com/acme/app/pull/42 for review.'

test('a chat that finished its turn shows the scripted summary on its row and a recap of what was asked, done, decided and referenced', async ({
  orcaPage,
  sessionServicesStub
}, testInfo) => {
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
  // Runs a chat turn, then waits for the registry scan, the utility-model summary and the recap.
  test.setTimeout(240_000)
  await useScriptedSessionServices(orcaPage, sessionServicesStub)
  writeSessionServicesScript(sessionServicesStub, { chat: { defaultReply: CHAT_REPLY } })

  const chat = await startStubChat(orcaPage, sessionServicesStub)
  await sendStubChatPrompt(chat, PROMPT)
  await expect(chat.root).toContainText(CHAT_REPLY, { timeout: 30_000 })

  let sessionId = ''
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(orcaPage)
        sessionId = (await readStubChatLiveSession(orcaPage, chat))?.id ?? ''
        return sessionId
      },
      { timeout: 60_000, message: 'the registry lists no session for the chat' }
    )
    .not.toBe('')
  await waitForLiveSession(
    orcaPage,
    sessionId,
    (found) => found.summary !== undefined && found.recap !== undefined,
    { message: 'the finished chat got no summary and recap' }
  )

  const row = orcaPage.locator(
    `[data-testid="active-agents"] [data-live-session-row="${sessionId}"]`
  )
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('data-status', 'your-turn')
  await expect(row.locator('[data-session-summary]')).toHaveText(SCRIPTED.summary)
  // The model wrote the line: it was asked once, about the chat's own reply.
  const summaryRequests = readUtilityRequests(sessionServicesStub, 'summary')
  expect(summaryRequests).toHaveLength(1)
  expect(summaryRequests[0].prompt).toContain(CHAT_REPLY)
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-row-summary.png') })

  await row.click()
  const pane = orcaPage.locator(`[data-live-session-pane="${sessionId}"]`)
  await expect(pane).toBeVisible()
  await pane.locator('[data-live-session-panel-toggle="recap"]').click()
  const panel = pane.locator('[data-live-session-panel="recap"]')
  await expect(panel).toBeVisible()
  const items = (section: string) => panel.locator(`[data-recap-section="${section}"] li`)
  await expect(items('asked')).toHaveText([SCRIPTED.recapAsked])
  await expect(items('did')).toHaveText([SCRIPTED.recapDid])
  await expect(items('decisions')).toHaveText([SCRIPTED.recapDecision])
  // The host reads references off the chat's journal; the model never names them.
  await expect(items('references')).toHaveText(['acme/app#42'])
  await orcaPage.screenshot({ path: testInfo.outputPath('chat-recap-open.png') })

  // The recap was written from the chat's own conversation, in one request.
  const recapRequests = readUtilityRequests(sessionServicesStub, 'recap')
  expect(recapRequests).toHaveLength(1)
  expect(recapRequests[0].prompt).toContain(`USER: ${PROMPT}`)
  expect(recapRequests[0].prompt).toContain(`AGENT: ${CHAT_REPLY}`)
  expect((await readSessionRecap(orcaPage, sessionId)).recap).toMatchObject({
    title: SCRIPTED.recapTitle,
    // The whole conversation was read: the panel does not call the recap partial.
    coveredFrom: 0,
    asked: [{ text: SCRIPTED.recapAsked }],
    did: [{ text: SCRIPTED.recapDid, state: 'done' }],
    decisions: [{ text: SCRIPTED.recapDecision }],
    references: [
      { kind: 'pr', label: 'acme/app#42', target: 'https://github.com/acme/app/pull/42' }
    ]
  })
})
