import type { AgentSessionAdapter } from '../../../shared/live-sessions/adapters/agent-session-adapter'
import { headlessResumeCommand } from '../delivery/headless-resume-command'
import { processProvider } from '../discovery/agent-processes'

/** What only the main process knows about Claude Code: how its sessions are found outside Seal. */
export const CLAUDE_SESSION_DISCOVERY: NonNullable<AgentSessionAdapter['discovery']> = {
  processMatch: (argv) => processProvider(argv.join(' ')) === 'claude',
  transcripts: {
    homeEnv: 'CLAUDE_CONFIG_DIR',
    defaultHome: '.claude',
    transcriptsDir: 'projects',
    filePattern: '*.jsonl'
  },
  resumeCommand: (session, text) =>
    headlessResumeCommand(session, text, {
      binary: 'claude',
      run: (id) => `claude -p --resume ${id} "$T"`
    })
}
