import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_CONFIG_SECRET_MASK } from '../../shared/agent-config/agent-config-types'
import { setPluginEnabled, runPluginCommand } from './agent-config-plugin-commands'
import {
  listMachineBackups,
  readManagedDocument,
  restoreMachineBackup,
  saveManagedDocument
} from './agent-config-managed-files'
import {
  copyMcpServer,
  patchSettings,
  removeMcpServer,
  revealMcpServer,
  saveMcpServer,
  setMcpActivation
} from './agent-config-settings-ops'
import {
  AGENT_CONFIG_TRANSPORTS,
  openFixtureMachine,
  type FixtureMachine
} from './testing/agent-config-transport-fixtures'

describe.skipIf(process.platform !== 'linux').each(AGENT_CONFIG_TRANSPORTS)(
  'agent configuration edits over %s',
  (_label, open) => {
    let machine: FixtureMachine

    beforeEach(async () => {
      machine = await openFixtureMachine(open)
    })
    afterEach(async () => {
      await machine.dispose()
    })

    const target = (agent: 'claude' | 'codex', inProject = false) => ({
      machineId: machine.connection.machineId,
      agent,
      ...(inProject ? { projectPath: machine.project } : {})
    })
    const text = (relative: string) => readFile(path.join(machine.home, relative), 'utf8')
    const json = async (relative: string) => JSON.parse(await text(relative))
    const mode = async (relative: string) =>
      (await stat(path.join(machine.home, relative))).mode & 0o777

    it('edits a Claude server keeping its hidden token, unknown keys and the rest of the file', async () => {
      const before = await json('.claude.json')
      const original = await text('.claude.json')

      const result = await saveMcpServer(machine.connection, {
        target: target('claude'),
        scope: 'user',
        originalName: 'docs',
        draft: {
          name: 'docs',
          transport: 'stdio',
          command: 'uvx',
          args: ['docs-mcp', '--fast'],
          env: { DOCS_TOKEN: AGENT_CONFIG_SECRET_MASK, REGION: 'us' },
          url: '',
          headers: {},
          enabled: true
        }
      })

      const after = await json('.claude.json')
      expect(after.mcpServers.docs).toEqual({
        type: 'stdio',
        command: 'uvx',
        args: ['docs-mcp', '--fast'],
        env: { DOCS_TOKEN: 'docs-secret-1', REGION: 'us' },
        timeout: 9000
      })
      expect({
        ...after,
        mcpServers: { ...after.mcpServers, docs: before.mcpServers.docs }
      }).toEqual(before)
      expect(await mode('.claude.json')).toBe(0o600)
      expect(result.backupPath).toMatch(
        new RegExp(`^${machine.home}/\\.seal/config-backups/[^/]+${machine.home}/\\.claude\\.json$`)
      )
      expect(await readFile(result.backupPath ?? '', 'utf8')).toBe(original)
      expect(JSON.stringify(result)).not.toContain('docs-secret-1')
    })

    it('adds, reveals, renames and removes Codex servers without touching comments or other tables', async () => {
      await saveMcpServer(machine.connection, {
        target: target('codex'),
        scope: 'user',
        draft: {
          name: 'tracker',
          transport: 'http',
          url: 'https://tracker.example/mcp',
          headers: { 'X-Api-Key': 'tracker-secret-5' },
          command: '',
          args: [],
          env: {},
          enabled: true
        }
      })
      await removeMcpServer(machine.connection, {
        target: target('codex'),
        scope: 'user',
        name: 'remote'
      })
      await saveMcpServer(machine.connection, {
        target: target('codex'),
        scope: 'user',
        originalName: 'docs',
        draft: {
          name: 'handbook',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'docs-mcp'],
          env: { DOCS_TOKEN: AGENT_CONFIG_SECRET_MASK },
          url: '',
          headers: {},
          enabled: true
        }
      })

      const content = await text('.codex/config.toml')
      expect(content.split('\n').slice(0, 9)).toEqual([
        '# Codex settings',
        'model = "gpt-5" # the default',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '[profiles.fast]',
        'model = "gpt-5-mini"',
        '',
        '# Servers'
      ])
      expect(content).not.toContain('[mcp_servers.remote]')
      expect(content).not.toContain('[mcp_servers.docs]')
      expect(await mode('.codex/config.toml')).toBe(0o600)

      const revealed = await revealMcpServer(machine.connection, {
        target: target('codex'),
        scope: 'user',
        name: 'handbook'
      })
      expect(revealed).toMatchObject({
        command: 'npx',
        args: ['-y', 'docs-mcp'],
        env: { DOCS_TOKEN: 'codex-secret-4' },
        extraKeys: ['startup_timeout_sec']
      })
      const tracker = await revealMcpServer(machine.connection, {
        target: target('codex'),
        scope: 'user',
        name: 'tracker'
      })
      expect(tracker).toMatchObject({
        transport: 'http',
        url: 'https://tracker.example/mcp',
        headers: { 'X-Api-Key': 'tracker-secret-5' }
      })
    })

    it('copies a server between agents and scopes, tokens included, and refuses to overwrite', async () => {
      await copyMcpServer(machine.connection, machine.connection, {
        target: target('claude'),
        scope: 'user',
        name: 'sentry',
        to: target('codex'),
        toScope: 'user'
      })
      const sentry = await revealMcpServer(machine.connection, {
        target: target('codex'),
        scope: 'user',
        name: 'sentry'
      })
      expect(sentry).toMatchObject({
        transport: 'http',
        url: 'https://mcp.sentry.dev/mcp',
        headers: { Authorization: 'Bearer sentry-secret-2' }
      })

      await copyMcpServer(machine.connection, machine.connection, {
        target: target('claude'),
        scope: 'user',
        name: 'sentry',
        to: target('claude', true),
        toScope: 'local'
      })
      const claudeJson = await json('.claude.json')
      expect(claudeJson.projects[machine.project].mcpServers.sentry).toEqual({
        type: 'http',
        url: 'https://mcp.sentry.dev/mcp',
        headers: { Authorization: 'Bearer sentry-secret-2' }
      })
      expect(claudeJson.projects[machine.project].hasTrustDialogAccepted).toBe(true)

      await expect(
        copyMcpServer(machine.connection, machine.connection, {
          target: target('claude'),
          scope: 'user',
          name: 'docs',
          to: target('claude', true),
          toScope: 'project'
        })
      ).rejects.toThrow('already exists')
      expect((await json('work/app/.mcp.json')).mcpServers.docs).toEqual({
        command: 'uvx',
        args: ['project-docs']
      })
    })

    it('changes settings keys and leaves keys it does not know alone', async () => {
      await patchSettings(machine.connection, {
        target: target('claude'),
        scope: 'user',
        edits: [
          { path: ['permissions', 'allow'], value: ['Read', 'Bash(pnpm test:*)'] },
          { path: ['model'], value: 'opus' },
          { path: ['statusLine'], remove: true }
        ]
      })
      expect(await json('.claude/settings.json')).toEqual({
        model: 'opus',
        permissions: { allow: ['Read', 'Bash(pnpm test:*)'], deny: ['Read(./.env)'] },
        env: { ANTHROPIC_API_KEY: 'anthropic-secret-3', EDITOR: 'vim' },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] },
        enabledPlugins: { 'hello@local-mkt': true },
        someFutureSetting: { keep: ['me'] }
      })

      await patchSettings(machine.connection, {
        target: target('codex'),
        scope: 'user',
        edits: [
          { path: ['model'], value: 'gpt-5-codex' },
          { path: ['profiles', 'careful', 'approval_policy'], value: 'untrusted' }
        ]
      })
      const toml = await text('.codex/config.toml')
      expect(toml).toContain('model = "gpt-5-codex" # the default')
      expect(toml).toContain('[profiles.careful]\napproval_policy = "untrusted"')
      expect(toml).toContain('[mcp_servers.docs.env]\nDOCS_TOKEN = "codex-secret-4"')

      await expect(
        patchSettings(machine.connection, {
          target: target('claude'),
          scope: 'user',
          edits: [{ path: ['env', 'ANTHROPIC_API_KEY'], value: AGENT_CONFIG_SECRET_MASK }]
        })
      ).rejects.toThrow('hidden value')
      expect((await json('.claude/settings.json')).env.ANTHROPIC_API_KEY).toBe('anthropic-secret-3')
    })

    it('refuses a raw save that would break the file, or that is based on a stale copy', async () => {
      const file = path.join(machine.home, '.claude/settings.json')
      const original = await text('.claude/settings.json')
      const opened = await readManagedDocument(machine.connection, target('claude'), file)
      expect(opened.content).toBe(original.replace('anthropic-secret-3', AGENT_CONFIG_SECRET_MASK))

      await expect(
        saveManagedDocument(machine.connection, target('claude'), {
          path: file,
          content: '{ "model": "opus", ',
          expectedHash: opened.hash
        })
      ).rejects.toThrow()
      await expect(
        saveManagedDocument(machine.connection, target('claude'), {
          path: file,
          content: '{ "permissions": { "allow": "Read" } }',
          expectedHash: opened.hash
        })
      ).rejects.toThrow('permissions.allow')
      expect(await text('.claude/settings.json')).toBe(original)

      await writeFile(file, '{ "model": "haiku" }\n')
      await expect(
        saveManagedDocument(machine.connection, target('claude'), {
          path: file,
          content: '{ "model": "opus" }\n',
          expectedHash: opened.hash
        })
      ).rejects.toThrow('changed')
      expect(await text('.claude/settings.json')).toBe('{ "model": "haiku" }\n')

      await expect(
        readManagedDocument(
          machine.connection,
          target('claude'),
          path.join(machine.home, '.ssh/id_ed25519')
        )
      ).rejects.toThrow()
    })

    it('hides stored secrets in the raw editor and keeps them when the file is saved', async () => {
      const file = path.join(machine.home, '.claude.json')
      const original = await text('.claude.json')
      const opened = await readManagedDocument(machine.connection, target('claude'), file)
      expect(opened.content).toBe(
        original
          .replace('docs-secret-1', AGENT_CONFIG_SECRET_MASK)
          .replace('Bearer sentry-secret-2', AGENT_CONFIG_SECRET_MASK)
      )

      await saveManagedDocument(machine.connection, target('claude'), {
        path: file,
        content: opened.content.replace('"REGION": "eu"', '"REGION": "us"'),
        expectedHash: opened.hash
      })
      expect(await text('.claude.json')).toBe(original.replace('"REGION": "eu"', '"REGION": "us"'))
    })

    it('writes through a dotfiles symlink instead of replacing it', async () => {
      const dotfiles = path.join(machine.home, 'dotfiles')
      await mkdir(dotfiles)
      await rename(
        path.join(machine.home, '.claude/settings.json'),
        path.join(dotfiles, 'claude-settings.json')
      )
      await symlink(
        path.join(dotfiles, 'claude-settings.json'),
        path.join(machine.home, '.claude/settings.json')
      )

      await patchSettings(machine.connection, {
        target: target('claude'),
        scope: 'user',
        edits: [{ path: ['model'], value: 'opus' }]
      })

      const link = path.join(machine.home, '.claude/settings.json')
      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(await readlink(link)).toBe(path.join(dotfiles, 'claude-settings.json'))
      expect((await json('dotfiles/claude-settings.json')).model).toBe('opus')
    })

    it('restores a backup, keeping what it replaces as a newer backup', async () => {
      const original = await text('.claude/settings.json')
      await patchSettings(machine.connection, {
        target: target('claude'),
        scope: 'user',
        edits: [{ path: ['model'], value: 'opus' }]
      })
      const edited = await text('.claude/settings.json')

      const [backup] = await listMachineBackups(machine.connection)
      expect(backup).toMatchObject({
        originalPath: `${machine.home}/.claude/settings.json`,
        isDirectory: false
      })
      const restored = await restoreMachineBackup(machine.connection, backup?.backupPath ?? '')

      expect(await text('.claude/settings.json')).toBe(original)
      expect(await readFile(restored.backupPath ?? '', 'utf8')).toBe(edited)
      expect(await listMachineBackups(machine.connection)).toHaveLength(2)
    })

    it('records the answer to "use this project server?" in the local settings file', async () => {
      await setMcpActivation(machine.connection, {
        target: target('claude', true),
        name: 'flaky',
        activation: 'approved'
      })
      await setMcpActivation(machine.connection, {
        target: target('claude', true),
        name: 'docs',
        activation: 'disabled'
      })
      expect(await json('work/app/.claude/settings.local.json')).toEqual({
        env: { EDITOR: 'nano' },
        enabledPlugins: { 'hello@local-mkt': false },
        disabledMcpjsonServers: ['docs'],
        enabledMcpjsonServers: ['flaky']
      })
    })

    it('switches plugins per scope and runs the machine’s own claude for installs', async () => {
      await setPluginEnabled(machine.connection, {
        target: target('claude', true),
        scope: 'project',
        plugin: 'hello@local-mkt',
        enabled: true
      })
      await setPluginEnabled(machine.connection, {
        target: target('claude', true),
        scope: 'local',
        plugin: 'hello@local-mkt',
        enabled: null
      })
      expect((await json('work/app/.claude/settings.json')).enabledPlugins).toEqual({
        'other@local-mkt': true,
        'hello@local-mkt': true
      })
      expect((await json('work/app/.claude/settings.local.json')).enabledPlugins).toEqual({})

      await mkdir(path.join(machine.home, 'bin'))
      await writeFile(
        path.join(machine.home, 'bin/claude'),
        '#!/bin/sh\nprintf \'%s\\n\' "$PWD" "$@" > "$HOME/claude-argv"\necho "Installed spare"\n',
        { mode: 0o755 }
      )
      const result = await runPluginCommand(machine.connection, {
        target: target('claude', true),
        command: { kind: 'install', plugin: 'spare@local-mkt', scope: 'project' }
      })
      expect(result).toMatchObject({ ok: true, output: 'Installed spare' })
      expect((await text('claude-argv')).trim().split('\n')).toEqual([
        machine.project,
        'plugin',
        'install',
        'spare@local-mkt',
        '--scope',
        'project'
      ])

      await expect(
        runPluginCommand(machine.connection, {
          target: target('claude'),
          command: { kind: 'install', plugin: 'spare; rm -rf ~', scope: 'user' }
        })
      ).rejects.toThrow()
    })
  }
)
