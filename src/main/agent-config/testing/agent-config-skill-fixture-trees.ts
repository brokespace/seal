import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

function skill(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Every place Claude Code, Codex, Cursor and the agents that borrow their folders load skills
 * from, laid out the way their own CLIs and plugin installers leave them, next to folders that
 * look like skills and are not loaded.
 */
export function skillFixtureFiles(home: string): Record<string, string> {
  const project = path.join(home, 'work', 'app')
  const claudeCache = path.join(home, '.claude/plugins/cache')
  const installed = (scope: string, installPath: string, version: string, extra = {}): object => ({
    scope,
    installPath,
    version,
    installedAt: '2026-11-14T05:54:29.327Z',
    lastUpdated: '2026-11-14T05:54:29.327Z',
    ...extra
  })
  return {
    // Kept outside any agent's folder and linked into several of them.
    'dotfiles/skills/shared-kit/SKILL.md': skill(
      'shared-kit',
      'Team conventions, kept in dotfiles.'
    ),

    '.claude/skills/drafts/unfinished/SKILL.md': skill(
      'unfinished',
      'Claude Code skips grouped folders.'
    ),
    '.claude/settings.json': json({
      model: 'sonnet',
      enabledPlugins: { 'hello@local-mkt': true, 'document-skills@anthropic-agent-skills': true },
      skillOverrides: { 'deploy-app': 'off', 'broken-skill': 'name-only' }
    }),
    '.claude/plugins/installed_plugins.json': json({
      version: 2,
      plugins: {
        'hello@local-mkt': [
          installed('user', path.join(claudeCache, 'local-mkt/hello/1.0.0'), '1.0.0')
        ],
        'other@local-mkt': [
          installed('project', path.join(claudeCache, 'local-mkt/other/1.0.0'), '1.0.0', {
            projectPath: project
          })
        ],
        'document-skills@anthropic-agent-skills': [
          installed(
            'user',
            path.join(claudeCache, 'anthropic-agent-skills/document-skills/1780c5e5a552'),
            '1780c5e5a552'
          )
        ]
      }
    }),
    '.claude/plugins/known_marketplaces.json': json({
      'local-mkt': {
        source: { source: 'github', repo: 'acme/claude-plugins' },
        installLocation: path.join(home, 'mkt'),
        lastUpdated: '2026-11-14T05:54:29.117Z'
      },
      'anthropic-agent-skills': {
        source: { source: 'github', repo: 'anthropics/skills' },
        installLocation: path.join(home, '.claude/plugins/marketplaces/anthropic-agent-skills'),
        lastUpdated: '2026-11-14T05:54:29.117Z'
      }
    }),
    // The marketplace repository is the plugin: only the skills it lists are loaded.
    '.claude/plugins/marketplaces/anthropic-agent-skills/.claude-plugin/marketplace.json': json({
      name: 'anthropic-agent-skills',
      owner: { name: 'Anthropic' },
      plugins: [
        {
          name: 'document-skills',
          description: 'Document processing',
          source: './',
          strict: false,
          skills: ['./skills/pdf', './skills/docx']
        }
      ]
    }),
    '.claude/plugins/cache/anthropic-agent-skills/document-skills/1780c5e5a552/skills/pdf/SKILL.md':
      skill('pdf', 'Read and fill PDF files.'),
    '.claude/plugins/cache/anthropic-agent-skills/document-skills/1780c5e5a552/skills/docx/SKILL.md':
      skill('docx', 'Create and edit Word documents.'),
    '.claude/plugins/cache/anthropic-agent-skills/document-skills/1780c5e5a552/skills/algorithmic-art/SKILL.md':
      skill('algorithmic-art', 'In the repository, not in this plugin.'),
    // A plugin with its own manifest: `skills/` plus the extra folder the manifest names.
    '.claude/plugins/cache/local-mkt/hello/1.0.0/.claude-plugin/plugin.json': json({
      name: 'hello',
      version: '1.0.0',
      description: 'Says hello',
      skills: ['./extra']
    }),
    '.claude/plugins/cache/local-mkt/hello/1.0.0/skills/greet/SKILL.md': skill(
      'greet',
      'Greets people by name.'
    ),
    '.claude/plugins/cache/local-mkt/hello/1.0.0/skills/greet/reference/SKILL.md': skill(
      'reference',
      'Inside another skill, so not a skill.'
    ),
    '.claude/plugins/cache/local-mkt/hello/1.0.0/extra/wave/SKILL.md': skill(
      'wave',
      'Waves goodbye.'
    ),
    '.claude/plugins/cache/local-mkt/hello/1.0.0/node_modules/dep/skills/vendored/SKILL.md': skill(
      'vendored',
      'A dependency, not a skill.'
    ),
    '.claude/plugins/cache/local-mkt/other/1.0.0/.claude-plugin/plugin.json': json({
      name: 'other',
      version: '1.0.0'
    }),
    '.claude/plugins/cache/local-mkt/other/1.0.0/skills/audit/SKILL.md': skill(
      'audit',
      'Audits this project only.'
    ),

    '.codex/config.toml': `# Codex settings
model = "gpt-5" # the default

[plugins."toolkit@openai-curated"]
enabled = true

[plugins."paused@openai-curated"]
enabled = false

[[skills.config]]
path = "${path.join(home, '.agents/skills/notes/SKILL.md')}"
enabled = false
`,
    '.codex/skills/ops/rollback/SKILL.md': skill('rollback', 'Roll a release back.'),
    '.codex/skills/.system/imagegen/SKILL.md': skill('imagegen', 'Generate images.'),
    '.codex/skills/.system/.codex-system-skills.marker': '821f2ce5c0a6\n',
    '.agents/skills/notes/SKILL.md': skill('notes', 'Keep running notes.'),
    '.codex/plugins/cache/openai-curated/toolkit/1.1.0/.codex-plugin/plugin.json': json({
      name: 'toolkit',
      version: '1.1.0',
      skills: './skills/'
    }),
    '.codex/plugins/cache/openai-curated/toolkit/1.1.0/skills/retired/SKILL.md': skill(
      'retired',
      'Only in the version before.'
    ),
    '.codex/plugins/cache/openai-curated/toolkit/1.2.0/.codex-plugin/plugin.json': json({
      name: 'toolkit',
      version: '1.2.0',
      skills: './skills/'
    }),
    '.codex/plugins/cache/openai-curated/toolkit/1.2.0/skills/build/SKILL.md': skill(
      'build',
      'Build the project.'
    ),
    '.codex/plugins/cache/openai-curated/toolkit/1.2.0/skills/web/deploy/SKILL.md': skill(
      'deploy',
      'Deploy the web app.'
    ),
    '.codex/plugins/cache/openai-curated/paused/0.3.0/.codex-plugin/plugin.json': json({
      name: 'paused',
      version: '0.3.0',
      skills: './skills/'
    }),
    '.codex/plugins/cache/openai-curated/paused/0.3.0/skills/idle/SKILL.md': skill(
      'idle',
      'Does nothing for now.'
    ),
    'work/app/.agents/skills/repo-check/SKILL.md': skill('repo-check', 'Checks this repository.'),

    '.cursor/skills/pr-review/SKILL.md': skill('pr-review', 'Review a pull request.'),
    '.cursor/skills-cursor/create-rule/SKILL.md': skill('create-rule', 'Create a Cursor rule.'),
    '.cursor/plugins/cache/cursor-public/404/cf1324609edb/.cursor-plugin/plugin.json': json({
      name: 'notion-workspace',
      version: '0.2.0'
    }),
    '.cursor/plugins/cache/cursor-public/404/cf1324609edb/skills/find/SKILL.md': skill(
      'find',
      'Find a Notion page.'
    ),
    '.cursor/plugins/cache/cursor-public/650/e32b05b5973d/plugin.json': json({ name: 'aws' }),
    '.cursor/plugins/cache/cursor-public/650/e32b05b5973d/skills/deploy/SKILL.md': skill(
      'deploy',
      'Deploy to AWS.'
    ),
    'work/app/.cursor/skills/storybook/SKILL.md': skill(
      'storybook',
      'Write a story for a component.'
    ),

    '.gemini/skills/summarize/SKILL.md': skill('summarize', 'Summarize a document.'),
    '.config/opencode/skills/refactor/SKILL.md': skill('refactor', 'Refactor safely.'),
    '.config/agents/skills/oracle/SKILL.md': skill('oracle', 'Ask for a second opinion.')
  }
}

/** Skill folders that are links, as a dotfiles setup makes them. */
const SKILL_FIXTURE_LINKS: Record<string, string> = {
  '.claude/skills/shared-kit': 'dotfiles/skills/shared-kit',
  '.agents/skills/shared-kit': 'dotfiles/skills/shared-kit'
}

/** Adds the skill trees on top of the fixture home, replacing the files they share with it. */
export async function writeSkillFixtureHome(home: string): Promise<void> {
  for (const [relative, content] of Object.entries(skillFixtureFiles(home))) {
    const file = path.join(home, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  for (const [link, target] of Object.entries(SKILL_FIXTURE_LINKS)) {
    await mkdir(path.dirname(path.join(home, link)), { recursive: true })
    await symlink(path.join(home, target), path.join(home, link), 'dir')
  }
}
