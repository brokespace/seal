import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyDocument,
  createDocument,
  deleteDocument,
  duplicateDocument,
  renameDocument
} from './agent-config-documents'
import { saveManagedDocument } from './agent-config-managed-files'
import { testMcpServer } from './agent-config-mcp-probe'
import { saveMcpServer } from './agent-config-settings-ops'
import { buildAgentConfigSnapshot } from './agent-config-snapshot'
import {
  AGENT_CONFIG_TRANSPORTS,
  openFixtureMachine,
  type FixtureMachine
} from './testing/agent-config-transport-fixtures'

describe.skipIf(process.platform !== 'linux').each(AGENT_CONFIG_TRANSPORTS)(
  'agent documents over %s',
  (_label, open) => {
    let machine: FixtureMachine
    let http: Server | null = null

    beforeEach(async () => {
      machine = await openFixtureMachine(open)
    })
    afterEach(async () => {
      http?.close()
      http = null
      await machine.dispose()
    })

    const target = (agent: 'claude' | 'codex', inProject = false) => ({
      machineId: machine.connection.machineId,
      agent,
      ...(inProject ? { projectPath: machine.project } : {})
    })
    const at = (relative: string) => path.join(machine.home, relative)
    const text = (relative: string) => readFile(at(relative), 'utf8')
    const exists = (relative: string) =>
      access(at(relative)).then(
        () => true,
        () => false
      )
    const skill = (relative: string) => ({
      kind: 'skill' as const,
      scope: 'user' as const,
      path: at(relative)
    })

    it('creates, duplicates, renames and deletes a skill, keeping its declared name in step', async () => {
      const created = await createDocument(machine.connection, {
        target: target('claude'),
        kind: 'skill',
        scope: 'user',
        name: 'release-notes'
      })
      expect(created.path).toBe(at('.claude/skills/release-notes/SKILL.md'))
      expect(await text('.claude/skills/release-notes/SKILL.md')).toMatch(
        /^---\nname: release-notes\ndescription: .+\n---\n/
      )
      await expect(
        createDocument(machine.connection, {
          target: target('claude'),
          kind: 'skill',
          scope: 'user',
          name: 'Release Notes'
        })
      ).rejects.toThrow()
      await expect(
        createDocument(machine.connection, {
          target: target('claude'),
          kind: 'skill',
          scope: 'user',
          name: 'deploy-app'
        })
      ).rejects.toThrow('already')

      await duplicateDocument(machine.connection, {
        target: target('claude'),
        ref: skill('.claude/skills/deploy-app/SKILL.md'),
        newName: 'deploy-prod'
      })
      expect(await text('.claude/skills/deploy-prod/SKILL.md')).toBe(
        '---\n# how agents find it\nname: deploy-prod\ndescription: Deploys the app to staging.\nlicense: MIT\n---\n\n# Deploy\n\nRun scripts/deploy.sh.\n'
      )
      expect((await stat(at('.claude/skills/deploy-prod/scripts/deploy.sh'))).mode & 0o111).toBe(
        0o111
      )

      await renameDocument(machine.connection, {
        target: target('claude'),
        ref: skill('.claude/skills/deploy-prod/SKILL.md'),
        newName: 'ship-prod'
      })
      expect(await exists('.claude/skills/deploy-prod')).toBe(false)
      expect(await text('.claude/skills/ship-prod/SKILL.md')).toContain('\nname: ship-prod\n')

      const deleted = await deleteDocument(machine.connection, {
        target: target('claude'),
        ref: skill('.claude/skills/ship-prod/SKILL.md')
      })
      expect(await exists('.claude/skills/ship-prod')).toBe(false)
      expect(await readFile(path.join(deleted.backupPath, 'scripts/deploy.sh'), 'utf8')).toBe(
        '#!/bin/sh\necho deployed\n'
      )
    })

    it('rejects a skill whose front matter would not load, and leaves the file alone', async () => {
      const file = at('.claude/skills/deploy-app/SKILL.md')
      const original = await text('.claude/skills/deploy-app/SKILL.md')
      await expect(
        saveManagedDocument(machine.connection, target('claude'), {
          path: file,
          content: '---\nname: deploy-app\ndescription: [unclosed\n---\n\nBody\n',
          validation: 'skill'
        })
      ).rejects.toThrow()
      await expect(
        saveManagedDocument(machine.connection, target('claude'), {
          path: file,
          content: '---\nname: deploy-app\n---\n\nBody\n',
          validation: 'skill'
        })
      ).rejects.toThrow('description')
      expect(await text('.claude/skills/deploy-app/SKILL.md')).toBe(original)

      const saved = await saveManagedDocument(machine.connection, target('claude'), {
        path: file,
        content: '---\nname: deploy-app\ndescription: Deploys to production.\n---\n\nBody\n',
        validation: 'skill'
      })
      expect(await readFile(saved.backupPath ?? '', 'utf8')).toBe(original)
    })

    it('copies documents to a project and to another agent, and backs up what it overwrites', async () => {
      const copied = await copyDocument(machine.connection, machine.connection, {
        target: target('claude'),
        ref: skill('.claude/skills/deploy-app/SKILL.md'),
        to: target('codex', true),
        toScope: 'project'
      })
      expect(copied.path).toBe(at('work/app/.codex/skills/deploy-app/SKILL.md'))
      expect(
        (await stat(at('work/app/.codex/skills/deploy-app/scripts/deploy.sh'))).mode & 0o111
      ).toBe(0o111)

      const instructions = {
        kind: 'instructions' as const,
        scope: 'user' as const,
        path: at('.claude/CLAUDE.md')
      }
      await expect(
        copyDocument(machine.connection, machine.connection, {
          target: target('claude'),
          ref: instructions,
          to: target('claude', true),
          toScope: 'project'
        })
      ).rejects.toThrow('already exists')
      const replaced = await copyDocument(machine.connection, machine.connection, {
        target: target('claude'),
        ref: instructions,
        to: target('claude', true),
        toScope: 'project',
        overwrite: true
      })
      expect(await text('work/app/CLAUDE.md')).toBe('# House rules\n\nAlways use tabs.\n')
      expect(await readFile(replaced.backupPath ?? '', 'utf8')).toBe('# App\n\nUse pnpm.\n')
    })

    it('creates the instructions file an agent reads, and nothing outside its folders', async () => {
      await createDocument(machine.connection, {
        target: target('codex', true),
        kind: 'instructions',
        scope: 'project',
        name: 'packages/api/AGENTS.md'
      })
      expect(await exists('work/app/packages/api/AGENTS.md')).toBe(true)
      await expect(
        createDocument(machine.connection, {
          target: target('codex', true),
          kind: 'instructions',
          scope: 'project',
          name: '../../.ssh/authorized_keys'
        })
      ).rejects.toThrow()
      const listed = await buildAgentConfigSnapshot(machine.connection, target('codex', true))
      expect(listed.docs.map((doc) => doc.relativePath)).toEqual([
        'AGENTS.md',
        'packages/api/AGENTS.md'
      ])
    })

    it('tests a stdio server with its stored variables and reports what answered', async () => {
      await mkdir(at('bin'))
      await writeFile(
        at('bin/fake-mcp'),
        [
          '#!/bin/sh',
          'read -r line',
          'ps -eo args > "$HOME/ps-during-probe"',
          'printf \'{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"fake-%s","version":"1.2.3"}}}\\n\' "$REGION"',
          'sleep 5',
          ''
        ].join('\n'),
        { mode: 0o755 }
      )
      await saveMcpServer(machine.connection, {
        target: target('claude'),
        scope: 'user',
        originalName: 'docs',
        draft: {
          name: 'docs',
          transport: 'stdio',
          command: 'fake-mcp',
          args: [],
          env: { DOCS_TOKEN: 'probe-secret-6', REGION: 'eu' },
          url: '',
          headers: {},
          enabled: true
        }
      })

      const result = await testMcpServer(machine.connection, {
        target: target('claude'),
        scope: 'user',
        name: 'docs'
      })
      expect(result).toMatchObject({
        status: 'connected',
        serverName: 'fake-eu',
        serverVersion: '1.2.3'
      })
      expect(await text('ps-during-probe')).not.toContain('probe-secret-6')

      await saveMcpServer(machine.connection, {
        target: target('claude'),
        scope: 'user',
        draft: {
          name: 'gone',
          transport: 'stdio',
          command: 'no-such-mcp-binary',
          args: [],
          env: {},
          url: '',
          headers: {},
          enabled: true
        }
      })
      const missing = await testMcpServer(machine.connection, {
        target: target('claude'),
        scope: 'user',
        name: 'gone'
      })
      expect(missing.status).toBe('failed')
    })

    it('tests an HTTP server: a rejected token is "needs sign-in", a good one connects', async () => {
      const seen: (string | undefined)[] = []
      http = createServer((request, response) => {
        seen.push(request.headers.authorization)
        if (request.headers.authorization !== 'Bearer good-token-7') {
          response.writeHead(401).end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"tracker","version":"9"}}}\n\n'
        )
      })
      await new Promise<void>((resolve) => http?.listen(0, '127.0.0.1', resolve))
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a server listening on TCP reports an AddressInfo.
      const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`
      const save = (token: string) =>
        saveMcpServer(machine.connection, {
          target: target('claude'),
          scope: 'user',
          originalName: 'sentry',
          draft: {
            name: 'sentry',
            transport: 'http',
            url,
            headers: { Authorization: `Bearer ${token}` },
            command: '',
            args: [],
            env: {},
            enabled: true
          }
        })
      const probe = () =>
        testMcpServer(machine.connection, {
          target: target('claude'),
          scope: 'user',
          name: 'sentry'
        })

      await save('wrong-token-8')
      const rejected = await probe()
      expect(rejected).toMatchObject({ status: 'needs-auth', httpStatus: 401 })
      expect(JSON.stringify(rejected)).not.toContain('wrong-token-8')

      await save('good-token-7')
      expect(await probe()).toMatchObject({
        status: 'connected',
        auth: 'static-header',
        serverName: 'tracker',
        serverVersion: '9',
        httpStatus: 200
      })
      expect(seen).toEqual(['Bearer wrong-token-8', 'Bearer good-token-7'])
    })
  }
)

describe.skipIf(process.platform !== 'linux')('agent documents between machines', () => {
  it('copies a skill folder from an SSH machine to a Seal server machine', async () => {
    const [ssh, server] = AGENT_CONFIG_TRANSPORTS.map(([, open]) => open)
    const machine = await openFixtureMachine(ssh!)
    try {
      const destination = server!()
      await destination.connect()
      const copied = await copyDocument(machine.connection, destination, {
        target: { machineId: machine.connection.machineId, agent: 'claude' },
        ref: {
          kind: 'skill',
          scope: 'user',
          path: path.join(machine.home, '.claude/skills/deploy-app/SKILL.md')
        },
        to: { machineId: destination.machineId, agent: 'claude', projectPath: machine.project },
        toScope: 'project'
      })
      expect(copied.path).toBe(path.join(machine.project, '.claude/skills/deploy-app/SKILL.md'))
      const script = path.join(machine.project, '.claude/skills/deploy-app/scripts/deploy.sh')
      expect(await readFile(script, 'utf8')).toBe('#!/bin/sh\necho deployed\n')
      expect((await stat(script)).mode & 0o111).toBe(0o111)
    } finally {
      await machine.dispose()
    }
  })
})
