import { z } from 'zod'

const machine = z
  .string()
  .describe('Machine id from list_machines (e.g. "local" or "ssh:<id>") or its exact label')

/** One schema per tool, shared by the Claude MCP server and the OpenAI-compatible loop. */
export const HOME_CHAT_TOOLS = {
  list_machines: {
    description:
      'List every machine Seal can reach: this computer plus configured SSH hosts, with connection state. Set probe_load to also measure CPU count and 1-minute load on connected machines.',
    shape: { probe_load: z.boolean().optional() }
  },
  run_command: {
    description:
      'Run a shell command on a machine (POSIX sh on SSH hosts and macOS/Linux, PowerShell on Windows). Returns exit code, stdout and stderr. Destructive commands require the user to approve them first.',
    shape: {
      machine,
      command: z.string().min(1),
      cwd: z.string().optional().describe('Working directory; defaults to the login directory'),
      timeout_seconds: z.number().int().min(1).max(3600).optional()
    }
  },
  read_file: {
    description: 'Read a UTF-8 text file from a machine.',
    shape: {
      machine,
      path: z.string().min(1),
      max_bytes: z.number().int().min(1).max(1_000_000).optional()
    }
  },
  write_file: {
    description:
      'Write (or append) UTF-8 text to a file on a machine, creating parent directories.',
    shape: {
      machine,
      path: z.string().min(1),
      content: z.string(),
      append: z.boolean().optional()
    }
  },
  transfer_file: {
    description:
      'Copy one file from a path on one machine to a path on another (either may be "local").',
    shape: {
      from_machine: machine,
      from_path: z.string().min(1),
      to_machine: machine,
      to_path: z.string().min(1)
    }
  },
  delete_path: {
    description: 'Delete a file or directory on a machine. Always asks the user first.',
    shape: { machine, path: z.string().min(1), recursive: z.boolean().optional() }
  },
  orca_cli: {
    description:
      "Run Seal's Orca CLI on this computer with the given arguments (without the leading `orca`). Use it to list projects/worktrees, create worktrees on any host with --host, launch agents and send them messages. Prefer --json.",
    shape: {
      args: z.array(z.string()).min(1),
      timeout_seconds: z.number().int().min(1).max(1800).optional()
    }
  },
  report_progress: {
    description:
      'Post a short progress note to the user while a long task runs (e.g. "Build started on gpu-box").',
    shape: { message: z.string().min(1) }
  }
} as const

export type HomeChatToolName = keyof typeof HOME_CHAT_TOOLS

export function isHomeChatToolName(name: string): name is HomeChatToolName {
  return Object.hasOwn(HOME_CHAT_TOOLS, name)
}

/** Validate untrusted tool arguments against the tool's schema. */
export function parseHomeChatToolInput(
  name: HomeChatToolName,
  input: unknown
): Record<string, unknown> {
  return z.object(HOME_CHAT_TOOLS[name].shape).parse(input ?? {})
}

export function homeChatToolJsonSchema(name: HomeChatToolName): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(z.object(HOME_CHAT_TOOLS[name].shape))
  return schema
}
