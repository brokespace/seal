import { z } from 'zod'

const sessionId = z.string().min(1).describe('Session id from list_sessions')
const provider = z.enum(['claude', 'codex'])

/** Tools for what Seal itself manages: agent sessions, AI accounts, skills and its own window. */
export const HOME_CHAT_SEAL_TOOLS = {
  list_sessions: {
    description:
      'List the Claude Code and Codex agent sessions Seal can see on every machine (or one machine): id, agent, machine, project folder, title, status (working, waiting-subagent, waiting-task, waiting-input, needs-permission, idle, done, errored), what it is doing, last activity, and whether it runs in a Seal pane or was found running outside Seal. Use it before messaging or taking over a session.',
    shape: {
      machine: z.string().optional().describe('Only this machine (id or label)'),
      include_done: z.boolean().optional().describe('Also list finished sessions (default false)')
    }
  },
  read_session: {
    description:
      "Read the newest messages of an agent session's transcript (what the user asked it and what it answered and ran).",
    shape: { session_id: sessionId, limit: z.number().int().min(1).max(100).optional() }
  },
  message_session: {
    description:
      "Send a message to a running agent session as if the user typed it. Seal delivers it through the session's own input (its Seal pane, the Codex queue, a tmux pane, or a headless resume) and reports whether it was delivered. The session answers in its own transcript: read it with read_session.",
    shape: { session_id: sessionId, text: z.string().min(1) }
  },
  take_over_session: {
    description:
      'Take over an agent session that runs outside Seal: Seal stops that process and resumes the same conversation in a Seal pane where the user can watch and steer it. Needs the user to approve.',
    shape: { session_id: sessionId }
  },
  start_session: {
    description:
      'Start a coding agent session on any machine. With worktree, the agent starts in that existing workspace; with project, Seal creates a new worktree on a feature branch first. The session shows up in Seal like any other and in list_sessions. For work you want to supervise to completion and be notified about, prefer spawn_subagent.',
    shape: {
      prompt: z.string().min(1).describe('The first message for the agent'),
      agent: z.string().optional().describe('Agent id: claude (default), codex, ...'),
      machine: z.string().optional().describe('Machine id or label; defaults to this computer'),
      project: z.string().optional().describe('Project id or name (see seal_cli project list)'),
      worktree: z
        .string()
        .optional()
        .describe('Existing workspace selector, e.g. "path:/srv/app" or "worktree:<id>"'),
      name: z.string().optional().describe('Name for the new worktree when project is given')
    }
  },
  account_usage: {
    description:
      "Show the user's Claude and Codex accounts as Seal manages them: which one is active, plan, session and weekly usage with reset times, and accounts that need signing in. Set refresh to re-read usage from the providers first.",
    shape: { provider: provider.optional(), refresh: z.boolean().optional() }
  },
  switch_account: {
    description:
      'Make another saved account the active one for a provider, so new agent sessions launch on it. account is the label, email or key from account_usage. Needs the user to approve.',
    shape: { provider, account: z.string().min(1) }
  },
  open_in_seal: {
    description:
      "Show something in the Seal window for the user: a top-level view (home, machines, sessions, tasks, activity, automations, skills, settings), a machine's page (id = machine id), or another assistant thread (id = thread id). To focus a workspace or terminal use seal_cli (`worktree switch`, `terminal switch`).",
    shape: {
      target: z.enum([
        'home',
        'machines',
        'sessions',
        'tasks',
        'activity',
        'automations',
        'skills',
        'settings',
        'machine',
        'thread'
      ]),
      id: z.string().optional()
    }
  },
  list_skills: {
    description:
      "List the skills and instruction files on a machine: skills under ~/.claude/skills, ~/.codex/skills, ~/.cursor/skills and ~/.agents/skills, agent definitions in ~/.claude/agents, prompts in ~/.codex/prompts, and the instruction files ~/.claude/CLAUDE.md and ~/.codex/AGENTS.md. Pass project_path to also include that repository's .claude/skills, CLAUDE.md and AGENTS.md. The system prompt already lists this computer's skills; call this for another machine or a project.",
    shape: {
      machine: z.string().optional().describe('Machine id or label; defaults to this computer'),
      project_path: z.string().optional().describe('A repository folder on that machine')
    }
  },
  load_skill: {
    description:
      "Load a skill's full instructions (its SKILL.md and the list of files beside it) so you can follow them. name is the skill name from the catalog; machine is where it lives (default: this computer).",
    shape: {
      name: z.string().min(1),
      machine: z.string().optional().describe('Machine id or label where the skill is installed')
    }
  }
}
