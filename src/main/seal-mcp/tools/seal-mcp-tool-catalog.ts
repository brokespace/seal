import { z } from 'zod'
import type { SealMcpClient, SealMcpScope } from '../../../shared/seal-mcp/seal-mcp-types'
import {
  HOME_CHAT_TOOLS,
  type HomeChatToolName
} from '../../home-chat/tools/home-chat-tool-definitions'

/** What a call can do at worst; decides which calls wait for approval. */
export type SealMcpToolRisk = 'read' | 'write' | 'command' | 'destructive'

export type SealMcpToolSpec = {
  description: string
  shape: z.ZodRawShape
  /** Every one of these must be granted to the client. */
  scopes: readonly SealMcpScope[]
  risk: SealMcpToolRisk
  /** Arguments that name a machine, checked against the client's machine allowlist. */
  machineArgs?: readonly string[]
  /** The machine argument is optional and means this computer when left out. */
  defaultsToLocal?: boolean
}

type HomeChatExposure = Omit<SealMcpToolSpec, 'description' | 'shape'> & {
  /** Replaces wording that only makes sense inside the Home assistant's chat. */
  description?: string
}

const MACHINE = ['machine'] as const

/**
 * The Home assistant tools an outside client may call, each with the scopes it needs. A Home
 * assistant tool that is not listed here is not reachable over MCP.
 */
const HOME_CHAT_EXPOSED = {
  list_machines: { scopes: ['read'], risk: 'read' },
  list_sessions: { scopes: ['read'], risk: 'read', machineArgs: MACHINE },
  read_session: { scopes: ['read'], risk: 'read' },
  account_usage: { scopes: ['read'], risk: 'read' },
  list_skills: { scopes: ['read'], risk: 'read', machineArgs: MACHINE, defaultsToLocal: true },
  load_skill: { scopes: ['read'], risk: 'read', machineArgs: MACHINE, defaultsToLocal: true },
  message_session: { scopes: ['sessions'], risk: 'write' },
  start_session: {
    scopes: ['sessions'],
    risk: 'write',
    machineArgs: MACHINE,
    defaultsToLocal: true,
    description:
      'Start a coding agent session on any machine. With worktree, the agent starts in that existing workspace (see list_workspaces); with project, Seal creates a new worktree on a feature branch first (see list_projects). The session shows up in Seal and in list_sessions; follow it with read_session and steer it with message_session.'
  },
  read_file: { scopes: ['files'], risk: 'read', machineArgs: MACHINE },
  write_file: { scopes: ['files'], risk: 'write', machineArgs: MACHINE },
  transfer_file: {
    scopes: ['files'],
    risk: 'write',
    machineArgs: ['from_machine', 'to_machine']
  },
  delete_path: {
    scopes: ['files', 'destructive'],
    risk: 'destructive',
    machineArgs: MACHINE,
    description:
      'Delete a file or directory on a machine. May wait for the user to approve it in the Seal app.'
  },
  run_command: {
    scopes: ['commands'],
    risk: 'command',
    machineArgs: MACHINE,
    description:
      'Run a shell script on a machine (bash/sh on POSIX hosts, PowerShell on Windows). Any text is safe to pass: Seal encodes the script, so no extra quoting or escaping is needed. stdout and stderr come back combined with the exit code. If the script is still running after timeout_seconds (default 30) it is NOT killed: it keeps running as a background job and you get a job id to check with job_status and job_output. Set background to start it as a job right away. Commands Seal recognizes as destructive need the destructive scope and may wait for the user to approve them in the Seal app.'
  },
  job_status: {
    scopes: ['commands'],
    risk: 'read',
    description:
      'Status of background jobs this client started. Without job_id, lists them; with job_id, checks it live on its machine (running, exited with code, or lost) and shows the last lines of output.'
  },
  job_output: { scopes: ['commands'], risk: 'read' },
  job_kill: { scopes: ['commands'], risk: 'write' },
  job_cleanup: { scopes: ['commands'], risk: 'write' },
  switch_account: {
    scopes: ['destructive'],
    risk: 'destructive',
    description:
      'Make another saved account the active one for a provider, so new agent sessions launch on it. account is the label, email or key from account_usage. May wait for the user to approve it in the Seal app.'
  }
} as const satisfies Partial<Record<HomeChatToolName, HomeChatExposure>>

export type SealMcpHomeChatToolName = keyof typeof HOME_CHAT_EXPOSED

/** Tools answered by Seal's runtime RPC methods rather than a Home assistant tool. */
export const SEAL_MCP_RPC_TOOLS = {
  list_projects: {
    description:
      'List the projects (repositories and folders) Seal manages: id, name, path, kind and the machine each lives on. Use a project id or name with start_session or list_workspaces.',
    shape: {},
    scopes: ['read'],
    risk: 'read'
  },
  list_workspaces: {
    description:
      "List Seal's workspaces (git worktrees and folder workspaces): id, path, branch and project. Pass project to list one project's workspaces. Use `worktree:<id>` or `path:<path>` as the worktree argument of start_session.",
    shape: {
      project: z.string().optional().describe('Project id or name from list_projects'),
      limit: z.number().int().min(1).max(500).optional()
    },
    scopes: ['read'],
    risk: 'read'
  },
  stop_session: {
    description:
      'Stop a running agent session: Seal ends its process and keeps its transcript, so read_session still works. May wait for the user to approve it in the Seal app.',
    shape: { session_id: z.string().min(1).describe('Session id from list_sessions') },
    scopes: ['sessions', 'destructive'],
    risk: 'destructive'
  }
} as const satisfies Record<string, SealMcpToolSpec>

export type SealMcpRpcToolName = keyof typeof SEAL_MCP_RPC_TOOLS
export type SealMcpToolName = SealMcpHomeChatToolName | SealMcpRpcToolName

function homeChatSpec(name: SealMcpHomeChatToolName): SealMcpToolSpec {
  const exposure: HomeChatExposure = HOME_CHAT_EXPOSED[name]
  const tool = HOME_CHAT_TOOLS[name]
  return { ...exposure, description: exposure.description ?? tool.description, shape: tool.shape }
}

export function isSealMcpHomeChatTool(name: string): name is SealMcpHomeChatToolName {
  return Object.hasOwn(HOME_CHAT_EXPOSED, name)
}

export function isSealMcpRpcTool(name: string): name is SealMcpRpcToolName {
  return Object.hasOwn(SEAL_MCP_RPC_TOOLS, name)
}

export function sealMcpToolSpec(name: string): SealMcpToolSpec | null {
  if (isSealMcpHomeChatTool(name)) {
    return homeChatSpec(name)
  }
  return isSealMcpRpcTool(name) ? SEAL_MCP_RPC_TOOLS[name] : null
}

export const SEAL_MCP_TOOL_NAMES: readonly SealMcpToolName[] = [
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Object.keys of the two tables is exactly their key unions.
  ...(Object.keys(HOME_CHAT_EXPOSED) as SealMcpHomeChatToolName[]),
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
  ...(Object.keys(SEAL_MCP_RPC_TOOLS) as SealMcpRpcToolName[])
]

export function clientMayUse(
  client: Pick<SealMcpClient, 'scopes'>,
  spec: SealMcpToolSpec
): boolean {
  return spec.scopes.every((scope) => client.scopes.includes(scope))
}

export type SealMcpToolListing = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint: boolean }
}

/** The tools this client's scopes allow, as `tools/list` returns them. */
export function sealMcpToolListFor(client: Pick<SealMcpClient, 'scopes'>): SealMcpToolListing[] {
  return SEAL_MCP_TOOL_NAMES.flatMap((name) => {
    const spec = sealMcpToolSpec(name)
    if (!spec || !clientMayUse(client, spec)) {
      return []
    }
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(z.object(spec.shape))
    return [
      {
        name,
        description: spec.description,
        inputSchema,
        annotations: {
          readOnlyHint: spec.risk === 'read',
          destructiveHint: spec.risk === 'destructive' || spec.risk === 'command'
        }
      }
    ]
  })
}

export function parseSealMcpToolInput(
  spec: SealMcpToolSpec,
  input: unknown
): Record<string, unknown> {
  return z.object(spec.shape).parse(input ?? {})
}
