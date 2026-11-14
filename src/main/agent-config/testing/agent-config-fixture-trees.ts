import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** A home folder the way Claude Code and Codex leave it, as their own CLIs write these files. */
export function fixtureHomeFiles(home: string): Record<string, string> {
  const project = path.join(home, 'work', 'app')
  return {
    '.claude.json': `${JSON.stringify(
      {
        firstStartTime: '2026-11-14T05:54:28.350Z',
        userID: 'u-979d3d357e5f',
        oauthAccount: { emailAddress: 'brian@example.com' },
        mcpServers: {
          docs: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'docs-mcp'],
            env: { DOCS_TOKEN: 'docs-secret-1', REGION: 'eu' },
            timeout: 9000
          },
          sentry: {
            type: 'http',
            url: 'https://mcp.sentry.dev/mcp',
            headers: { Authorization: 'Bearer sentry-secret-2' }
          }
        },
        projects: {
          [project]: {
            allowedTools: [],
            mcpServers: {
              scratch: { type: 'stdio', command: 'node', args: ['scratch.js'], env: {} }
            },
            enabledMcpjsonServers: ['tracker'],
            disabledMcpjsonServers: [],
            hasTrustDialogAccepted: true
          }
        }
      },
      null,
      2
    )}\n`,
    '.claude/settings.json': `{
  "model": "sonnet",
  "permissions": {
    "allow": ["Bash(git status:*)", "Read"],
    "deny": ["Read(./.env)"]
  },
  "env": {
    "ANTHROPIC_API_KEY": "anthropic-secret-3",
    "EDITOR": "vim"
  },
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "notify-send done" }] }]
  },
  "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" },
  "enabledPlugins": {
    "hello@local-mkt": true
  },
  "someFutureSetting": { "keep": ["me"] }
}
`,
    '.claude/CLAUDE.md': '# House rules\n\nAlways use tabs.\n',
    '.claude/skills/deploy-app/SKILL.md':
      '---\n# how agents find it\nname: deploy-app\ndescription: Deploys the app to staging.\nlicense: MIT\n---\n\n# Deploy\n\nRun scripts/deploy.sh.\n',
    '.claude/skills/deploy-app/scripts/deploy.sh': '#!/bin/sh\necho deployed\n',
    '.claude/skills/broken-skill/SKILL.md':
      '---\nname: Broken Skill\n---\n\nNo description here.\n',
    '.claude/agents/reviewer.md':
      '---\nname: reviewer\ndescription: Reviews diffs for bugs.\ntools: Read, Grep\n---\n\nYou review code.\n',
    '.claude/commands/review.md':
      '---\ndescription: Review the current diff\n---\n\nReview $ARGUMENTS\n',
    '.claude/commands/frontend/test.md': 'Run the frontend tests.\n',
    '.claude/plugins/installed_plugins.json': `${JSON.stringify(
      {
        version: 2,
        plugins: {
          'hello@local-mkt': [
            {
              scope: 'user',
              installPath: path.join(home, '.claude/plugins/cache/local-mkt/hello/1.0.0'),
              version: '1.0.0',
              installedAt: '2026-11-14T05:54:29.327Z',
              lastUpdated: '2026-11-14T05:54:29.327Z'
            }
          ],
          'other@local-mkt': [
            {
              scope: 'project',
              installPath: path.join(home, '.claude/plugins/cache/local-mkt/other/1.0.0'),
              version: '1.0.0',
              installedAt: '2026-11-14T05:54:29.547Z',
              lastUpdated: '2026-11-14T05:54:29.547Z',
              projectPath: project
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    '.claude/plugins/known_marketplaces.json': `${JSON.stringify(
      {
        'local-mkt': {
          source: { source: 'github', repo: 'acme/claude-plugins' },
          installLocation: path.join(home, 'mkt'),
          lastUpdated: '2026-11-14T05:54:29.117Z'
        }
      },
      null,
      2
    )}\n`,
    'mkt/.claude-plugin/marketplace.json': `${JSON.stringify({
      name: 'local-mkt',
      owner: { name: 'acme' },
      plugins: [
        { name: 'hello', source: './plugins/hello', description: 'Says hello', version: '1.0.0' },
        { name: 'other', source: './plugins/other', description: 'Does other things' },
        { name: 'spare', source: './plugins/spare', description: 'Not installed yet' }
      ]
    })}\n`,
    '.codex/config.toml': `# Codex settings
model = "gpt-5" # the default
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[profiles.fast]
model = "gpt-5-mini"

# Servers
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]
startup_timeout_sec = 20

[mcp_servers.docs.env]
DOCS_TOKEN = "codex-secret-4"

[mcp_servers.remote]
url = "https://mcp.example/mcp"
bearer_token_env_var = "EX_TOKEN"
`,
    '.codex/AGENTS.md': '# Codex rules\n\nPrefer small diffs.\n',
    '.codex/prompts/summarize.md': '---\ndescription: Summarize the thread\n---\n\nSummarize.\n',
    '.codex/skills/triage/SKILL.md':
      '---\nname: triage\ndescription: Triage incoming issues.\n---\n\nLabel and assign.\n',
    'work/app/CLAUDE.md': '# App\n\nUse pnpm.\n',
    'work/app/CLAUDE.local.md': '# Mine\n\nMy sandbox URL.\n',
    'work/app/AGENTS.md': '# App agents\n\nRun the tests.\n',
    'work/app/packages/api/CLAUDE.md': '# API\n\nREST only.\n',
    'work/app/node_modules/dep/CLAUDE.md': '# Not ours\n',
    'work/app/.claude/settings.json': `{
  "model": "opus",
  "permissions": {
    "allow": ["Read", "Bash(pnpm test:*)"]
  },
  "enabledPlugins": {
    "other@local-mkt": true
  }
}
`,
    'work/app/.claude/settings.local.json': `{
  "env": {
    "EDITOR": "nano"
  },
  "enabledPlugins": {
    "hello@local-mkt": false
  },
  "disabledMcpjsonServers": ["flaky"]
}
`,
    'work/app/.claude/skills/lint-fix/SKILL.md':
      '---\nname: lint-fix\ndescription: Fix lint errors in this repo.\n---\n\nRun the linter.\n',
    'work/app/.claude/agents/tester.md':
      '---\nname: tester\ndescription: Writes and runs tests.\n---\n\nYou test.\n',
    'work/app/.claude/commands/ship.md': 'Ship it.\n',
    'work/app/.mcp.json': `{
  "mcpServers": {
    "tracker": {
      "type": "sse",
      "url": "https://tracker.example/sse"
    },
    "flaky": {
      "command": "flaky-mcp"
    },
    "docs": {
      "command": "uvx",
      "args": ["project-docs"]
    }
  }
}
`,
    'work/app/.codex/config.toml':
      'model = "gpt-5-codex"\n\n[mcp_servers.build]\ncommand = "build-mcp"\n'
  }
}

/** Writes the fixture tree; the files Claude Code and Codex keep private get their real modes. */
export async function writeFixtureHome(home: string): Promise<{ project: string }> {
  for (const [relative, content] of Object.entries(fixtureHomeFiles(home))) {
    const file = path.join(home, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  await chmod(path.join(home, '.claude.json'), 0o600)
  await chmod(path.join(home, '.codex/config.toml'), 0o600)
  await chmod(path.join(home, '.claude/skills/deploy-app/scripts/deploy.sh'), 0o755)
  return { project: path.join(home, 'work', 'app') }
}
