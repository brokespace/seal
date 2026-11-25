import { z } from 'zod'

const sessionId = z.string().min(1).describe('Session id from list_sessions')
const provider = z.enum(['claude', 'codex'])

/** Tools for what Seal itself manages: agent sessions, AI accounts, skills and its own window. */
export const HOME_CHAT_SEAL_TOOLS = {
  list_sessions: {
    description:
      'List the agent sessions Seal tracks on every machine (or one machine or project), of every agent: id, agent, machine, folder, project, title, status (working, running-shell = a shell command it started is still running, waiting-subagent, waiting-task, waiting-input = it asked the user a question, needs-permission = a tool or command waits for approval, your-turn = it finished its turn and waits for the next message, idle = not given anything yet, done = ended, errored), what it is doing, last activity, and whether it is a Seal chat, runs in a Seal pane or was found running outside Seal. Use it before messaging or taking over a session.',
    shape: {
      machine: z.string().optional().describe('Only this machine (id or label)'),
      project: z.string().optional().describe('Only this project (name or key)'),
      include_done: z.boolean().optional().describe('Also list finished sessions (default false)')
    }
  },
  read_session: {
    description:
      'Read an agent session: its status (and the question it waits on, if any), then its transcript: what it was asked and what it answered and ran. Shows the newest messages; page back through the whole history with before, which each answer gives. latest_turn shows only the newest turn: the last message it was sent and everything since.',
    shape: {
      session_id: sessionId,
      limit: z.number().int().min(1).max(100).optional().describe('Messages per read (default 20)'),
      before: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Read the messages before this point: the value an earlier read_session gave'),
      latest_turn: z.boolean().optional().describe('Only the newest turn'),
      full_text: z
        .boolean()
        .optional()
        .describe('Keep long messages whole (default: each is shortened to 1,500 characters)')
    }
  },
  message_session: {
    description:
      'Send a message to an agent session as if the user typed it. A Seal chat gets it as a normal chat message; any other session through its own input (its Seal pane, the Codex queue, a tmux pane, or a headless resume). Seal reports whether it was delivered. The session answers in its own transcript: read it with read_session.',
    shape: { session_id: sessionId, text: z.string().min(1) }
  },
  take_over_session: {
    description:
      'Take over an agent session that runs outside Seal: Seal stops that process and resumes the same conversation in a Seal pane where the user can watch and steer it. Needs the user to approve.',
    shape: { session_id: sessionId }
  },
  start_session: {
    description:
      'Start a coding agent on any machine as a Seal chat, the same as the New chat button. With worktree, it starts in that existing workspace; with cwd, in the workspace that holds that folder; with project, Seal creates a new worktree on a feature branch first. The session shows up in Seal like any other and in list_sessions; the answer gives its id. For work you want to supervise to completion and be notified about, prefer spawn_subagent.',
    shape: {
      prompt: z
        .string()
        .optional()
        .describe('The first message for the agent; leave out to open the chat idle'),
      agent: z.string().optional().describe('Agent id: claude (default), codex, ...'),
      model: z
        .string()
        .optional()
        .describe("The agent's model id, e.g. opus or gpt-5-codex (default: the agent's own)"),
      effort: z.string().optional().describe('Reasoning effort for that model; needs model'),
      machine: z.string().optional().describe('Machine id or label; defaults to this computer'),
      project: z.string().optional().describe('Project id or name'),
      worktree: z
        .string()
        .optional()
        .describe('Existing workspace selector, e.g. "path:/srv/app" or "worktree:<id>"'),
      cwd: z
        .string()
        .optional()
        .describe('A folder on the machine: the chat starts in the Seal workspace that holds it'),
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
      "Show something in the Seal window for the user: a top-level view (home, machines, tasks, automations, skills, settings), the agent sessions in the sidebar (sessions or activity), a machine's page (id = machine id), or another assistant thread (id = thread id). To focus a workspace or terminal use seal_cli (`worktree switch`, `terminal switch`).",
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
