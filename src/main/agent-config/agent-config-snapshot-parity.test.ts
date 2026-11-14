import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_CONFIG_SECRET_MASK } from '../../shared/agent-config/agent-config-types'
import { buildAgentConfigSnapshot } from './agent-config-snapshot'
import {
  AGENT_CONFIG_TRANSPORTS,
  openFixtureMachine,
  type FixtureMachine
} from './testing/agent-config-transport-fixtures'

const FIXTURE_SECRETS = ['docs-secret-1', 'sentry-secret-2', 'anthropic-secret-3', 'codex-secret-4']

describe.skipIf(process.platform !== 'linux').each(AGENT_CONFIG_TRANSPORTS)(
  'agent configuration read over %s',
  (_label, open) => {
    let machine: FixtureMachine

    beforeEach(async () => {
      machine = await openFixtureMachine(open)
    })
    afterEach(async () => {
      await machine.dispose()
    })

    const snapshot = (agent: 'claude' | 'codex', inProject = false) =>
      buildAgentConfigSnapshot(machine.connection, {
        machineId: machine.connection.machineId,
        agent,
        ...(inProject ? { projectPath: machine.project } : {})
      })

    it('lists the Claude Code account: documents, settings, servers and plugins', async () => {
      const result = await snapshot('claude')
      const { home } = machine

      expect(result.agentDir).toBe(`${home}/.claude`)
      expect(result.docs.map((doc) => [doc.kind, doc.scope, doc.name, doc.path])).toEqual([
        ['instructions', 'user', 'CLAUDE.md', `${home}/.claude/CLAUDE.md`],
        ['skill', 'user', 'Broken Skill', `${home}/.claude/skills/broken-skill/SKILL.md`],
        ['skill', 'user', 'deploy-app', `${home}/.claude/skills/deploy-app/SKILL.md`],
        ['subagent', 'user', 'reviewer', `${home}/.claude/agents/reviewer.md`],
        ['command', 'user', 'frontend/test', `${home}/.claude/commands/frontend/test.md`],
        ['command', 'user', 'review', `${home}/.claude/commands/review.md`]
      ])
      const broken = result.docs.find((doc) => doc.name === 'Broken Skill')
      expect(broken?.issues.map((issue) => issue.field)).toEqual(['name', 'description'])
      expect(result.docs.find((doc) => doc.name === 'deploy-app')).toMatchObject({
        description: 'Deploys the app to staging.',
        directory: `${home}/.claude/skills/deploy-app`,
        issues: []
      })

      expect(result.settings).toHaveLength(1)
      expect(result.settings[0]).toMatchObject({
        scope: 'user',
        format: 'json',
        maskedPaths: ['env.ANTHROPIC_API_KEY']
      })
      expect(result.settings[0]?.value).toMatchObject({
        model: 'sonnet',
        env: { ANTHROPIC_API_KEY: AGENT_CONFIG_SECRET_MASK, EDITOR: 'vim' },
        someFutureSetting: { keep: ['me'] }
      })

      expect(result.mcp).toEqual([
        {
          name: 'docs',
          scope: 'user',
          sourcePath: `${home}/.claude.json`,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'docs-mcp'],
          env: { DOCS_TOKEN: AGENT_CONFIG_SECRET_MASK, REGION: 'eu' },
          url: '',
          headers: {},
          maskedFields: ['env.DOCS_TOKEN'],
          enabled: true,
          extraKeys: ['timeout']
        },
        {
          name: 'sentry',
          scope: 'user',
          sourcePath: `${home}/.claude.json`,
          transport: 'http',
          command: '',
          args: [],
          env: {},
          url: 'https://mcp.sentry.dev/mcp',
          headers: { Authorization: AGENT_CONFIG_SECRET_MASK },
          maskedFields: ['headers.Authorization'],
          enabled: true,
          extraKeys: []
        }
      ])

      expect(
        result.plugins?.plugins.map((plugin) => [plugin.id, plugin.enabled, plugin.enabledBy])
      ).toEqual([
        ['hello@local-mkt', true, 'user'],
        ['other@local-mkt', false, null]
      ])
      expect(result.plugins?.marketplaces).toEqual([
        {
          name: 'local-mkt',
          source: 'acme/claude-plugins',
          installLocation: `${home}/mkt`,
          lastUpdated: '2026-11-14T05:54:29.117Z',
          plugins: [
            { name: 'hello', description: 'Says hello', version: '1.0.0', installed: true },
            { name: 'other', description: 'Does other things', version: null, installed: true },
            { name: 'spare', description: 'Not installed yet', version: null, installed: false }
          ]
        }
      ])
    })

    it('never sends a stored secret to the window', async () => {
      const everything = JSON.stringify([
        await snapshot('claude'),
        await snapshot('claude', true),
        await snapshot('codex'),
        await snapshot('codex', true)
      ])
      for (const secret of FIXTURE_SECRETS) {
        expect(everything).not.toContain(secret)
      }
    })

    it('lists a project: nested instructions, server approval, and where each value comes from', async () => {
      const result = await snapshot('claude', true)
      const { project } = machine

      expect(result.docs.map((doc) => [doc.kind, doc.scope, doc.relativePath ?? doc.name])).toEqual(
        [
          ['instructions', 'project', 'CLAUDE.md'],
          ['instructions', 'local', 'CLAUDE.local.md'],
          ['instructions', 'project', 'packages/api/CLAUDE.md'],
          ['skill', 'project', 'lint-fix'],
          ['subagent', 'project', 'tester'],
          ['command', 'project', 'ship']
        ]
      )
      expect(
        result.files.map((file) => [file.scope, file.path.replace(project, '<project>')])
      ).toEqual([
        ['user', `${machine.home}/.claude/settings.json`],
        ['user', `${machine.home}/.claude.json`],
        ['project', '<project>/.claude/settings.json'],
        ['local', '<project>/.claude/settings.local.json'],
        ['project', '<project>/.mcp.json']
      ])

      expect(
        result.mcp.map((server) => [
          server.name,
          server.scope,
          server.activation ?? null,
          server.shadowedBy ?? null
        ])
      ).toEqual([
        ['docs', 'user', null, 'project'],
        ['sentry', 'user', null, null],
        ['tracker', 'project', 'approved', null],
        ['flaky', 'project', 'disabled', null],
        ['docs', 'project', 'pending', null],
        ['scratch', 'local', null, null]
      ])

      const effective = new Map(result.effective.map((entry) => [entry.key, entry]))
      expect(effective.get('model')).toEqual({
        key: 'model',
        value: '"opus"',
        source: 'project',
        overrides: [{ source: 'user', value: '"sonnet"' }]
      })
      expect(effective.get('env.EDITOR')).toEqual({
        key: 'env.EDITOR',
        value: '"nano"',
        source: 'local',
        overrides: [{ source: 'user', value: '"vim"' }]
      })
      expect(effective.get('permissions.allow')?.items).toEqual([
        { value: '"Bash(git status:*)"', source: 'user' },
        { value: '"Read"', source: 'user' },
        { value: '"Bash(pnpm test:*)"', source: 'project' }
      ])

      expect(
        result.plugins?.plugins.map((plugin) => [plugin.id, plugin.enabled, plugin.enabledBy])
      ).toEqual([
        ['hello@local-mkt', false, 'local'],
        ['other@local-mkt', true, 'project']
      ])
    })

    it('lists Codex: config.toml layers, servers, prompts and skills', async () => {
      const account = await snapshot('codex')
      expect(account.docs.map((doc) => [doc.kind, doc.name])).toEqual([
        ['instructions', 'AGENTS.md'],
        ['skill', 'triage'],
        ['prompt', 'summarize']
      ])

      const result = await snapshot('codex', true)
      expect(result.settings.map((layer) => [layer.scope, layer.format, layer.value])).toEqual([
        [
          'user',
          'toml',
          {
            model: 'gpt-5',
            approval_policy: 'on-request',
            sandbox_mode: 'workspace-write',
            profiles: { fast: { model: 'gpt-5-mini' } }
          }
        ],
        ['project', 'toml', { model: 'gpt-5-codex' }]
      ])
      expect(
        result.mcp.map((server) => [server.name, server.scope, server.transport, server.extraKeys])
      ).toEqual([
        ['docs', 'user', 'stdio', ['startup_timeout_sec']],
        ['remote', 'user', 'http', ['bearer_token_env_var']],
        ['build', 'project', 'stdio', []]
      ])
      expect(result.effective.find((entry) => entry.key === 'model')).toEqual({
        key: 'model',
        value: '"gpt-5-codex"',
        source: 'project',
        overrides: [{ source: 'user', value: '"gpt-5"' }]
      })
    })
  }
)
