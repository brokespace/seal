import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentConfigAgentId,
  AgentConfigDocRef
} from '../../shared/agent-config/agent-config-types'
import { copyDocument, deleteDocument } from './agent-config-documents'
import { setSkillEnabled } from './agent-config-settings-ops'
import { buildAgentConfigSnapshot } from './agent-config-snapshot'
import { writeSkillFixtureHome } from './testing/agent-config-skill-fixture-trees'
import {
  AGENT_CONFIG_TRANSPORTS,
  openFixtureMachine,
  type FixtureMachine
} from './testing/agent-config-transport-fixtures'

function source(doc: AgentConfigDocRef): string {
  if (!doc.bundle) {
    return doc.scope
  }
  return doc.bundle.kind === 'builtin'
    ? 'built-in'
    : `${doc.bundle.id} ${doc.bundle.version} ${doc.bundle.enabled === false ? 'off' : 'on'}`
}

describe.skipIf(process.platform !== 'linux').each(AGENT_CONFIG_TRANSPORTS)(
  'skills listed over %s',
  (_label, open) => {
    let machine: FixtureMachine

    beforeEach(async () => {
      machine = await openFixtureMachine(open)
      await writeSkillFixtureHome(machine.home)
    })
    afterEach(async () => {
      await machine.dispose()
    })

    const target = (agent: AgentConfigAgentId, inProject = false) => ({
      machineId: machine.connection.machineId,
      agent,
      ...(inProject ? { projectPath: machine.project } : {})
    })
    const at = (relative: string) => path.join(machine.home, relative)
    const skills = async (agent: AgentConfigAgentId, inProject = false) =>
      (await buildAgentConfigSnapshot(machine.connection, target(agent, inProject))).docs
        .filter((doc) => doc.kind === 'skill')
        .map((doc) => [
          source(doc),
          doc.disabled ? `${doc.name} (off)` : doc.name,
          doc.path.replace(`${machine.home}/`, '')
        ])

    it('lists what Claude Code loads: account, linked and plugin skills, and no look-alikes', async () => {
      const cache = '.claude/plugins/cache'
      const account = [
        ['user', 'Broken Skill', '.claude/skills/broken-skill/SKILL.md'],
        ['user', 'deploy-app (off)', '.claude/skills/deploy-app/SKILL.md'],
        ['user', 'shared-kit', '.claude/skills/shared-kit/SKILL.md']
      ]
      const documents = 'document-skills@anthropic-agent-skills 1780c5e5a552 on'
      const documentSkills = [
        [
          documents,
          'docx',
          `${cache}/anthropic-agent-skills/document-skills/1780c5e5a552/skills/docx/SKILL.md`
        ],
        [
          documents,
          'pdf',
          `${cache}/anthropic-agent-skills/document-skills/1780c5e5a552/skills/pdf/SKILL.md`
        ]
      ]
      const hello = (state: string) => [
        [
          `hello@local-mkt 1.0.0 ${state}`,
          'wave',
          `${cache}/local-mkt/hello/1.0.0/extra/wave/SKILL.md`
        ],
        [
          `hello@local-mkt 1.0.0 ${state}`,
          'greet',
          `${cache}/local-mkt/hello/1.0.0/skills/greet/SKILL.md`
        ]
      ]

      expect(await skills('claude')).toEqual([...account, ...documentSkills, ...hello('on')])
      // The project adds its own skills and its own plugin, and switches `hello` off for itself.
      expect(await skills('claude', true)).toEqual([
        ['project', 'lint-fix', 'work/app/.claude/skills/lint-fix/SKILL.md'],
        ...account,
        ...documentSkills,
        ...hello('off'),
        [
          'other@local-mkt 1.0.0 on',
          'audit',
          `${cache}/local-mkt/other/1.0.0/skills/audit/SKILL.md`
        ]
      ])

      const listed = (await buildAgentConfigSnapshot(machine.connection, target('claude'))).docs
      expect(listed.find((doc) => doc.name === 'pdf')).toMatchObject({
        description: 'Read and fill PDF files.',
        directory: at(`${cache}/anthropic-agent-skills/document-skills/1780c5e5a552/skills/pdf`),
        bundle: { kind: 'plugin', name: 'document-skills' },
        issues: []
      })
    })

    it('lists what Codex loads: grouped, linked, built-in and plugin skills', async () => {
      const cache = '.codex/plugins/cache/openai-curated'
      const account = [
        ['user', 'rollback', '.codex/skills/ops/rollback/SKILL.md'],
        ['user', 'triage', '.codex/skills/triage/SKILL.md'],
        ['user', 'notes (off)', '.agents/skills/notes/SKILL.md'],
        ['user', 'shared-kit', '.agents/skills/shared-kit/SKILL.md'],
        ['built-in', 'imagegen', '.codex/skills/.system/imagegen/SKILL.md'],
        [
          'toolkit@openai-curated 1.2.0 on',
          'build',
          `${cache}/toolkit/1.2.0/skills/build/SKILL.md`
        ],
        [
          'toolkit@openai-curated 1.2.0 on',
          'deploy',
          `${cache}/toolkit/1.2.0/skills/web/deploy/SKILL.md`
        ],
        ['paused@openai-curated 0.3.0 off', 'idle', `${cache}/paused/0.3.0/skills/idle/SKILL.md`]
      ]
      expect(await skills('codex')).toEqual(account)
      expect(await skills('codex', true)).toEqual([
        ['project', 'repo-check', 'work/app/.agents/skills/repo-check/SKILL.md'],
        ...account
      ])
    })

    it('lists what Cursor loads: its own, the folders it borrows, built-in and plugin skills', async () => {
      const account = [
        ['user', 'pr-review', '.cursor/skills/pr-review/SKILL.md'],
        ['user', 'notes', '.agents/skills/notes/SKILL.md'],
        ['user', 'shared-kit', '.agents/skills/shared-kit/SKILL.md'],
        ['user', 'Broken Skill', '.claude/skills/broken-skill/SKILL.md'],
        ['user', 'deploy-app', '.claude/skills/deploy-app/SKILL.md'],
        ['user', 'shared-kit', '.claude/skills/shared-kit/SKILL.md'],
        ['user', 'triage', '.codex/skills/triage/SKILL.md'],
        ['built-in', 'create-rule', '.cursor/skills-cursor/create-rule/SKILL.md'],
        [
          'cursor-public/404 0.2.0 on',
          'find',
          '.cursor/plugins/cache/cursor-public/404/cf1324609edb/skills/find/SKILL.md'
        ],
        [
          'cursor-public/650 null on',
          'deploy',
          '.cursor/plugins/cache/cursor-public/650/e32b05b5973d/skills/deploy/SKILL.md'
        ]
      ]
      expect(await skills('cursor')).toEqual(account)
      expect(await skills('cursor', true)).toEqual([
        ['project', 'storybook', 'work/app/.cursor/skills/storybook/SKILL.md'],
        ['project', 'repo-check', 'work/app/.agents/skills/repo-check/SKILL.md'],
        ['project', 'lint-fix', 'work/app/.claude/skills/lint-fix/SKILL.md'],
        ...account
      ])
      const listed = (await buildAgentConfigSnapshot(machine.connection, target('cursor'))).docs
      expect(listed.find((doc) => doc.name === 'find')?.bundle).toMatchObject({
        name: 'notion-workspace'
      })
    })

    it('lists the folders Gemini CLI, OpenCode and Amp read besides their own', async () => {
      const agents = [
        ['user', 'notes', '.agents/skills/notes/SKILL.md'],
        ['user', 'shared-kit', '.agents/skills/shared-kit/SKILL.md']
      ]
      const claude = [
        ['user', 'Broken Skill', '.claude/skills/broken-skill/SKILL.md'],
        ['user', 'deploy-app', '.claude/skills/deploy-app/SKILL.md'],
        ['user', 'shared-kit', '.claude/skills/shared-kit/SKILL.md']
      ]
      expect(await skills('gemini')).toEqual([
        ['user', 'summarize', '.gemini/skills/summarize/SKILL.md'],
        ...agents
      ])
      expect(await skills('opencode')).toEqual([
        ['user', 'refactor', '.config/opencode/skills/refactor/SKILL.md'],
        ...agents,
        ...claude
      ])
      expect(await skills('amp', true)).toEqual([
        ['project', 'repo-check', 'work/app/.agents/skills/repo-check/SKILL.md'],
        ['project', 'lint-fix', 'work/app/.claude/skills/lint-fix/SKILL.md'],
        ['user', 'oracle', '.config/agents/skills/oracle/SKILL.md'],
        ...claude
      ])
    })

    it('switches a Codex skill off and on in config.toml, leaving every other line alone', async () => {
      const before = await readFile(at('.codex/config.toml'), 'utf8')
      const triage = at('.codex/skills/triage/SKILL.md')
      const change = (skillPath: string, enabled: boolean) =>
        setSkillEnabled(machine.connection, {
          target: target('codex'),
          scope: 'user',
          path: skillPath,
          enabled
        })

      await change(triage, false)
      expect(await readFile(at('.codex/config.toml'), 'utf8')).toBe(
        `${before}\n[[skills.config]]\npath = "${triage}"\nenabled = false\n`
      )
      expect((await skills('codex')).map((skill) => skill[1])).toContain('triage (off)')

      await change(triage, true)
      expect(await readFile(at('.codex/config.toml'), 'utf8')).toBe(before)

      await change(at('.agents/skills/notes/SKILL.md'), true)
      expect(await readFile(at('.codex/config.toml'), 'utf8')).toBe(
        before.slice(0, before.indexOf('\n[[skills.config]]'))
      )
      expect((await skills('codex')).map((skill) => skill[1])).toContain('notes')
    })

    it('switches a Claude Code skill by its folder name, in the scope asked for', async () => {
      const settings = async (relative: string) =>
        JSON.parse(await readFile(at(relative), 'utf8')) as Record<string, unknown>
      const change = (scope: 'user' | 'local', relative: string, enabled: boolean) =>
        setSkillEnabled(machine.connection, {
          target: target('claude', scope !== 'user'),
          scope,
          path: at(relative),
          enabled
        })

      await change('user', '.claude/skills/shared-kit/SKILL.md', false)
      await change('user', '.claude/skills/broken-skill/SKILL.md', true)
      expect((await settings('.claude/settings.json')).skillOverrides).toEqual({
        'deploy-app': 'off',
        'shared-kit': 'off'
      })

      // The account says off; only an explicit "on" lets this project have the skill back.
      await change('local', '.claude/skills/deploy-app/SKILL.md', true)
      expect((await settings('work/app/.claude/settings.local.json')).skillOverrides).toEqual({
        'deploy-app': 'on'
      })
      expect((await skills('claude', true)).map((skill) => skill[1])).toContain('deploy-app')
      expect((await skills('claude')).map((skill) => skill[1])).toContain('deploy-app (off)')
    })

    it('copies a plugin skill into the account, and removes a linked skill without its target', async () => {
      await copyDocument(machine.connection, machine.connection, {
        target: target('claude'),
        ref: {
          kind: 'skill',
          scope: 'user',
          path: at('.claude/plugins/cache/local-mkt/hello/1.0.0/skills/greet/SKILL.md')
        },
        to: target('codex'),
        toScope: 'user'
      })
      expect(await readFile(at('.codex/skills/greet/SKILL.md'), 'utf8')).toContain('name: greet')

      await deleteDocument(machine.connection, {
        target: target('claude'),
        ref: { kind: 'skill', scope: 'user', path: at('.claude/skills/shared-kit/SKILL.md') }
      })
      await expect(lstat(at('.claude/skills/shared-kit'))).rejects.toThrow()
      expect(await readFile(at('dotfiles/skills/shared-kit/SKILL.md'), 'utf8')).toContain(
        'name: shared-kit'
      )
      expect((await skills('claude')).map((skill) => skill[1])).not.toContain('shared-kit')
    })
  }
)
