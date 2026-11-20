import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveWorkspaceLaunchDirectory } from './agent-session-create-launch-directory'

const REFUSED = {
  refusal: { code: 'structured_agent_session_unsupported', details: { reason: 'hostUnsupported' } }
}

let sandbox: string
let workspace: string

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'orca-create-launch-directory-')))
  workspace = join(sandbox, 'app')
  await mkdir(join(workspace, 'packages', 'web'), { recursive: true })
  await mkdir(join(sandbox, 'app2'))
  await writeFile(join(workspace, 'README.md'), 'readme')
})

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

describe('resolveWorkspaceLaunchDirectory', () => {
  it('starts in a folder inside the workspace', async () => {
    await expect(resolveWorkspaceLaunchDirectory(workspace, 'packages/web')).resolves.toBe(
      join(workspace, 'packages', 'web')
    )
  })

  it.each(['.', 'packages/..'])(
    'records nothing for the workspace root, asked as %s',
    async (at) => {
      await expect(resolveWorkspaceLaunchDirectory(workspace, at)).resolves.toBeUndefined()
    }
  )

  it.each(['../app2', 'packages/../../app2', 'missing', 'README.md'])(
    'refuses %s, which is not a folder inside the workspace',
    async (at) => {
      await expect(resolveWorkspaceLaunchDirectory(workspace, at)).rejects.toMatchObject(REFUSED)
    }
  )

  it('refuses an absolute folder outside the workspace', async () => {
    await expect(
      resolveWorkspaceLaunchDirectory(workspace, join(sandbox, 'app2'))
    ).rejects.toMatchObject(REFUSED)
  })

  it('refuses a link inside the workspace that leads out of it', async () => {
    await symlink(join(sandbox, 'app2'), join(workspace, 'escape'), 'junction')
    await expect(resolveWorkspaceLaunchDirectory(workspace, 'escape')).rejects.toMatchObject(
      REFUSED
    )
  })
})
