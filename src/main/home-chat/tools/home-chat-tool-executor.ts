import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { HomeChatToolName } from './home-chat-tool-definitions'
import type {
  HomeChatExecResult,
  HomeChatMachineProvider
} from '../machines/home-chat-machine-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'

const MAX_TOOL_OUTPUT_CHARS = 30_000

export type HomeChatToolContext = {
  machines: HomeChatMachineProvider
  runOrcaCli: (
    args: readonly string[],
    options: { timeoutMs: number; signal?: AbortSignal }
  ) => Promise<HomeChatExecResult>
  reportProgress: (message: string) => void
  signal?: AbortSignal
}

export type HomeChatToolResult = { text: string; isError: boolean; machine?: string }

function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) {
    return text
  }
  const half = MAX_TOOL_OUTPUT_CHARS / 2
  return `${text.slice(0, half)}\n… [${text.length - MAX_TOOL_OUTPUT_CHARS} characters omitted] …\n${text.slice(-half)}`
}

export function formatExecResult(result: HomeChatExecResult): HomeChatToolResult {
  const status = result.timedOut ? 'timed out' : `exit code ${result.exitCode ?? 'unknown'}`
  const parts = [status]
  if (result.stdout.trim()) {
    parts.push(`stdout:\n${clip(result.stdout.trimEnd())}`)
  }
  if (result.stderr.trim()) {
    parts.push(`stderr:\n${clip(result.stderr.trimEnd())}`)
  }
  return { text: parts.join('\n\n'), isError: result.timedOut || result.exitCode !== 0 }
}

const str = (value: unknown): string => String(value ?? '')

async function transfer(
  ctx: HomeChatToolContext,
  input: Record<string, unknown>
): Promise<HomeChatToolResult> {
  const from = await ctx.machines.open(str(input.from_machine))
  const to = await ctx.machines.open(str(input.to_machine))
  const label = `${from.info.label} → ${to.info.label}`
  const fromPath = str(input.from_path)
  const toPath = str(input.to_path)
  if (from.info.kind === 'local') {
    await to.uploadFrom(fromPath, toPath)
  } else if (to.info.kind === 'local') {
    await from.downloadTo(fromPath, toPath)
  } else {
    // Machines cannot reach each other directly, so stage through this computer.
    const staging = await mkdtemp(join(tmpdir(), 'seal-transfer-'))
    try {
      const staged = join(staging, basename(fromPath) || 'file')
      await from.downloadTo(fromPath, staged)
      await to.uploadFrom(staged, toPath)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  return { text: `Copied ${fromPath} to ${toPath} (${label}).`, isError: false, machine: label }
}

async function listMachines(
  ctx: HomeChatToolContext,
  probeLoad: boolean
): Promise<HomeChatToolResult> {
  const machines = await ctx.machines.list()
  const rows = await Promise.all(
    machines.map(async (info) => {
      if (!probeLoad || !info.connected) {
        return info
      }
      try {
        const machine = await ctx.machines.open(info.id)
        return { ...info, load: await machine.probeLoad() }
      } catch (error) {
        return { ...info, loadError: error instanceof Error ? error.message : String(error) }
      }
    })
  )
  return { text: JSON.stringify(rows, null, 2), isError: false }
}

export async function executeHomeChatTool(
  tool: HomeChatToolName,
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  switch (tool) {
    case 'list_machines':
      return listMachines(ctx, input.probe_load === true)
    case 'run_command': {
      const machine = await ctx.machines.open(str(input.machine))
      const timeoutSeconds = typeof input.timeout_seconds === 'number' ? input.timeout_seconds : 120
      const result = await machine.exec(str(input.command), {
        cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
        timeoutMs: timeoutSeconds * 1000,
        signal: ctx.signal
      })
      return { ...formatExecResult(result), machine: machine.info.label }
    }
    case 'read_file': {
      const machine = await ctx.machines.open(str(input.machine))
      const maxBytes = typeof input.max_bytes === 'number' ? input.max_bytes : 200_000
      const { text, truncated } = await machine.readTextFile(str(input.path), maxBytes)
      const suffix = truncated ? `\n… [truncated at ${maxBytes} bytes]` : ''
      return { text: clip(text) + suffix, isError: false, machine: machine.info.label }
    }
    case 'write_file': {
      const machine = await ctx.machines.open(str(input.machine))
      const content = str(input.content)
      await machine.writeTextFile(str(input.path), content, { append: input.append === true })
      const verb = input.append === true ? 'Appended' : 'Wrote'
      return {
        text: `${verb} ${Buffer.byteLength(content, 'utf8')} bytes to ${str(input.path)}.`,
        isError: false,
        machine: machine.info.label
      }
    }
    case 'transfer_file':
      return transfer(ctx, input)
    case 'delete_path': {
      const machine = await ctx.machines.open(str(input.machine))
      const path = str(input.path)
      const command =
        machine.info.platform === 'win32'
          ? `Remove-Item -LiteralPath '${path.replaceAll("'", "''")}' -Force${input.recursive === true ? ' -Recurse' : ''}`
          : `rm -f${input.recursive === true ? 'r' : ''} -- ${quotePosixShell(path)}`
      const result = await machine.exec(command, { timeoutMs: 120_000, signal: ctx.signal })
      return { ...formatExecResult(result), machine: machine.info.label }
    }
    case 'orca_cli': {
      const args = Array.isArray(input.args) ? input.args.map(String) : []
      const timeoutSeconds = typeof input.timeout_seconds === 'number' ? input.timeout_seconds : 300
      const result = await ctx.runOrcaCli(args, {
        timeoutMs: timeoutSeconds * 1000,
        signal: ctx.signal
      })
      return formatExecResult(result)
    }
    case 'report_progress':
      ctx.reportProgress(str(input.message))
      return { text: 'Shown to the user.', isError: false }
  }
}
