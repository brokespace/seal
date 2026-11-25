import { z } from 'zod'

const machine = z
  .string()
  .describe(
    'Machine id from list_machines ("local", "machine:<id>", "hop:<name>"), or its name as the user says it (label or host name)'
  )

const jobId = z.string().min(1).describe('Job id returned by run_command')

/** Tools that act on one or more of the user's machines. */
export const HOME_CHAT_MACHINE_TOOLS = {
  list_machines: {
    description:
      'List every machine Seal can reach, exactly as its Machines page shows them: this computer, every machine the user added (whether Seal connects over SSH or via its Seal server), and machines reached through another machine. Each has an id, label, how it is reached, status (online, connecting, offline, error) and saved notes. Set probe_load to also measure CPU count and 1-minute load on online machines.',
    shape: { probe_load: z.boolean().optional() }
  },
  run_command: {
    description:
      'Run a shell script on a machine (bash/sh on POSIX hosts, PowerShell on Windows). Any text is safe to pass: Seal encodes the script, so no extra quoting or escaping is needed. stdout and stderr come back combined with the exit code. If the script is still running after timeout_seconds (default 30) it is NOT killed: it keeps running as a background job and you get a job id; Seal posts a notice in this chat when it exits. Set background to start it as a job right away (dev servers, watchers, long builds). Destructive commands need the user to approve them first.',
    shape: {
      machine,
      command: z.string().min(1),
      cwd: z.string().optional().describe('Working directory; defaults to the home directory'),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(3600)
        .optional()
        .describe('Seconds to wait before moving the command to the background (default 30)'),
      background: z.boolean().optional().describe('Return a job id immediately without waiting')
    }
  },
  job_status: {
    description:
      'Status of background jobs started in this chat. Without job_id, lists them; with job_id, checks it live on its machine (running, exited with code, or lost) and shows the last lines of output.',
    shape: { job_id: z.string().optional() }
  },
  job_output: {
    description:
      "Read a job's output log (stdout and stderr combined). By default returns the last max_bytes; pass offset to read from a byte position instead (the status shows the total size).",
    shape: {
      job_id: jobId,
      max_bytes: z.number().int().min(100).max(200_000).optional(),
      offset: z.number().int().min(0).optional()
    }
  },
  job_kill: {
    description: 'Stop a background job and everything it started.',
    shape: { job_id: jobId }
  },
  job_cleanup: {
    description:
      "Delete a finished job's log folder (~/.seal/jobs/<id>) on its machine. Folders older than 7 days are pruned automatically.",
    shape: { job_id: jobId }
  },
  read_file: {
    description:
      'Read a UTF-8 text file from a machine. Paths may be absolute, start with ~, or be relative to the home directory; the same holds for every file tool.',
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
      'Copy a file (or, with recursive, a directory) from one machine to another; either may be "local". to_path is the full path of the copy (the file itself, or the directory that becomes the copy); missing parent directories are created. Files stream rather than load into memory. method "auto" (default) has the source machine push straight to the destination with rsync/scp when it can log in there, otherwise relays through this computer. "direct" requires the push, "relay" always goes through this computer (files only).',
    shape: {
      from_machine: machine,
      from_path: z.string().min(1),
      to_machine: machine,
      to_path: z.string().min(1),
      recursive: z.boolean().optional(),
      method: z.enum(['auto', 'direct', 'relay']).optional()
    }
  },
  delete_path: {
    description: 'Delete a file or directory on a machine. Always asks the user first.',
    shape: { machine, path: z.string().min(1), recursive: z.boolean().optional() }
  },
  attach_file: {
    description:
      'Show a file from any machine in the chat: images appear inline, other files as a download. Use it to hand results to the user (screenshots, reports, logs, archives).',
    shape: {
      machine,
      path: z.string().min(1),
      name: z.string().optional().describe('File name to show; defaults to the path basename')
    }
  }
} as const
