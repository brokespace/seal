// A session started outside Seal is listed under the workspace whose folder holds its cwd.
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  seedExternalClaudeSession,
  type ExternalClaudeSession
} from './helpers/external-claude-session'
import { waitForLiveSession } from './helpers/live-session-registry'
import { addSeedWorkspaces, removeSeedWorkspaces } from './helpers/seeded-workspaces'
import { showSidebar, workspaceSessionRow } from './helpers/sidebar-session-row'

test('sessions started in a workspace folder and in a subfolder of it are listed under that workspace', async ({
  electronApp,
  orcaPage
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  // Each session is found by a scan, and scans come 3 to 12 seconds apart.
  test.setTimeout(180_000)
  await showSidebar(orcaPage)
  const [workspace] = await addSeedWorkspaces(orcaPage, 1)
  const sessions: ExternalClaudeSession[] = []
  try {
    const atFolder = await seedExternalClaudeSession(electronApp, { cwd: workspace.path })
    sessions.push(atFolder)
    // The seeded repository commits a `src` folder, so every worktree of it has one.
    const inSubfolder = await seedExternalClaudeSession(electronApp, {
      cwd: path.join(workspace.path, 'src')
    })
    sessions.push(inSubfolder)
    atFolder.submitPrompt('Started in the workspace folder')
    inSubfolder.submitPrompt('Started in a subfolder')

    for (const session of sessions) {
      const listed = await waitForLiveSession(
        orcaPage,
        session.sessionId,
        (found) => found.workspace !== undefined
      )
      expect(listed.workspace?.worktreeId).toBe(workspace.id)
    }
    const rows = orcaPage.locator(
      `[data-workspace-session-rows="${workspace.id}"] [data-live-session-row]`
    )
    await expect(rows).toHaveCount(2)
    await expect(workspaceSessionRow(orcaPage, workspace.id, atFolder.sessionId)).toContainText(
      'Started in the workspace folder'
    )
    await expect(workspaceSessionRow(orcaPage, workspace.id, inSubfolder.sessionId)).toContainText(
      'Started in a subfolder'
    )
  } finally {
    for (const session of sessions) {
      session.stop()
    }
    await removeSeedWorkspaces(orcaPage, [workspace])
  }
})
