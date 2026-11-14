/** Folders and file names that are never part of a project's own instructions. */
export const AGENT_CONFIG_NESTED_SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'vendor',
  'target',
  '.venv',
  '.next',
  '.cache'
]

/** How deep under a project root nested instruction files are looked for. */
export const AGENT_CONFIG_NESTED_MAX_DEPTH = 6

/** How many folders below a skills folder a skill may sit; Codex, which reads grouped skills, stops at 6. */
export const AGENT_CONFIG_SKILL_MAX_DEPTH = 6
