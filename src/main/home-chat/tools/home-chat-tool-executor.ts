import {
  isHomeChatMachineToolName,
  isHomeChatSealToolName,
  type HomeChatMachineToolName,
  type HomeChatToolName
} from './home-chat-tool-definitions'
import {
  clipToolText,
  formatExecResult,
  optionalStr,
  str,
  type HomeChatToolContext,
  type HomeChatToolResult
} from './home-chat-tool-context'
import { absoluteMachinePath, posixPathWord } from '../machines/home-chat-machine-paths'
import { powerShellLiteral } from '../machines/home-chat-machine-scripts'
import { executeAssistantTool } from './home-chat-assistant-tool-handlers'
import { executeSealTool } from './home-chat-seal-tool-handlers'
import { transferBetweenMachines } from './home-chat-transfer'

export type { HomeChatToolContext, HomeChatToolResult } from './home-chat-tool-context'
export { formatExecResult } from './home-chat-tool-context'

const DEFAULT_WAIT_SECONDS = 30

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

function outputBlock(output: string, totalBytes: number, jobId?: string): string {
  const shown = Buffer.byteLength(output, 'utf8')
  const rest = jobId ? `job_output with job_id ${jobId} reads the rest` : 'job_output reads more'
  const note = totalBytes > shown ? `[last ${shown} of ${totalBytes} bytes; ${rest}]\n` : ''
  return output.trim()
    ? `\n\noutput (stdout+stderr):\n${note}${clipToolText(output.trimEnd())}`
    : '\n\n(no output)'
}

async function runCommand(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const waitSeconds =
    input.background === true ? 0 : (num(input.timeout_seconds) ?? DEFAULT_WAIT_SECONDS)
  const result = await ctx.services.jobs.run({
    chatId: ctx.chatId,
    machine: str(input.machine),
    command: str(input.command),
    cwd: optionalStr(input.cwd),
    waitSeconds,
    signal: ctx.signal
  })
  if (result.kind === 'finished') {
    return {
      text: `exit code ${result.exitCode ?? 'unknown'}${outputBlock(result.output, result.totalBytes, result.jobId)}`,
      isError: result.exitCode !== 0,
      machine: result.machineLabel
    }
  }
  const { job } = result
  const lead =
    waitSeconds === 0
      ? `Started background job ${job.id} on ${job.machineLabel}.`
      : `Still running after ${waitSeconds}s, so it continues as background job ${job.id} on ${job.machineLabel}.`
  return {
    text: `${lead} A notice will arrive in this chat when it exits; check it with job_status/job_output or stop it with job_kill.${outputBlock(result.output, result.totalBytes, job.id)}`,
    isError: false,
    machine: job.machineLabel
  }
}

async function jobStatus(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const id = optionalStr(input.job_id)
  if (!id) {
    const jobs = ctx.services.jobs.list(ctx.chatId)
    const rows = jobs.map(
      (job) =>
        `${job.id} on ${job.machineLabel}: ${job.state}${job.exitCode !== undefined && job.exitCode !== null ? ` (exit ${job.exitCode})` : ''}, started ${new Date(job.startedAt).toISOString()}: ${job.command.slice(0, 120)}`
    )
    return { text: rows.join('\n') || 'No background jobs in this chat.', isError: false }
  }
  const { job, report } = await ctx.services.jobs.status(id)
  const state =
    report.state === 'exited'
      ? `exited with code ${report.exitCode}`
      : report.state === 'running'
        ? `running (pid ${report.pid})`
        : report.state === 'lost'
          ? 'lost (the process is gone without an exit code, e.g. the machine rebooted)'
          : 'missing (its folder was removed)'
  const tail = 'output' in report ? outputBlock(report.output, report.totalBytes, job.id) : ''
  return {
    text: `Job ${job.id} on ${job.machineLabel}: ${state}.${tail}`,
    isError: false,
    machine: job.machineLabel
  }
}

async function executeMachineTool(
  tool: HomeChatMachineToolName,
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  switch (tool) {
    case 'list_machines':
      return listMachines(ctx, input.probe_load === true)
    case 'run_command':
      return runCommand(input, ctx)
    case 'job_status':
      return jobStatus(input, ctx)
    case 'job_output': {
      const text = await ctx.services.jobs.output(str(input.job_id), {
        offset: num(input.offset),
        length: num(input.max_bytes) ?? 20_000
      })
      return { text: clipToolText(text), isError: false }
    }
    case 'job_kill': {
      const job = await ctx.services.jobs.kill(str(input.job_id))
      return {
        text: `Stopped job ${job.id} on ${job.machineLabel}.`,
        isError: false,
        machine: job.machineLabel
      }
    }
    case 'job_cleanup':
      await ctx.services.jobs.remove(str(input.job_id))
      return { text: `Removed job ${str(input.job_id)}'s folder.`, isError: false }
    case 'read_file': {
      const machine = await ctx.machines.open(str(input.machine))
      const maxBytes = num(input.max_bytes) ?? 200_000
      const path = await absoluteMachinePath(machine, str(input.path))
      const { text, truncated } = await machine.readTextFile(path, maxBytes)
      if (text.includes('\0')) {
        return {
          text: `${path} is a binary file, so its bytes cannot be shown as text. Show it to the user with attach_file, copy it with transfer_file, or inspect it with run_command (file, xxd, strings).`,
          isError: true,
          machine: machine.info.label
        }
      }
      const suffix = truncated ? `\n… [truncated at ${maxBytes} bytes]` : ''
      return { text: clipToolText(text) + suffix, isError: false, machine: machine.info.label }
    }
    case 'write_file': {
      const machine = await ctx.machines.open(str(input.machine))
      const content = str(input.content)
      const path = await absoluteMachinePath(machine, str(input.path))
      await machine.writeTextFile(path, content, { append: input.append === true })
      const verb = input.append === true ? 'Appended' : 'Wrote'
      return {
        text: `${verb} ${Buffer.byteLength(content, 'utf8')} bytes to ${path}.`,
        isError: false,
        machine: machine.info.label
      }
    }
    case 'transfer_file': {
      const method = input.method === 'direct' || input.method === 'relay' ? input.method : 'auto'
      const { text, label } = await transferBetweenMachines(ctx.machines, {
        fromMachine: str(input.from_machine),
        fromPath: str(input.from_path),
        toMachine: str(input.to_machine),
        toPath: str(input.to_path),
        recursive: input.recursive === true,
        method,
        signal: ctx.signal
      })
      return { text, isError: false, machine: label }
    }
    case 'delete_path': {
      const machine = await ctx.machines.open(str(input.machine))
      const path =
        machine.dialect === 'powershell'
          ? powerShellLiteral(str(input.path))
          : posixPathWord(str(input.path))
      const recursive = input.recursive === true
      const command =
        machine.dialect === 'powershell'
          ? `Remove-Item -LiteralPath ${path} -Force${recursive ? ' -Recurse' : ''}`
          : `rm -f${recursive ? 'r' : ''} -- ${path}`
      const result = await machine.exec(command, { timeoutMs: 120_000, signal: ctx.signal })
      return { ...formatExecResult(result), machine: machine.info.label }
    }
    case 'attach_file': {
      const machine = await ctx.machines.open(str(input.machine))
      const info = await ctx.services.attachments.importFrom(
        machine,
        ctx.chatId,
        await absoluteMachinePath(machine, str(input.path)),
        optionalStr(input.name)
      )
      ctx.showAttachment({ ...info, machine: machine.info.label })
      return {
        text: `Showed ${info.name} (${info.mimeType}, ${info.size} bytes) to the user.`,
        isError: false,
        machine: machine.info.label
      }
    }
  }
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
  if (isHomeChatMachineToolName(tool)) {
    return executeMachineTool(tool, input, ctx)
  }
  return isHomeChatSealToolName(tool)
    ? executeSealTool(tool, input, ctx)
    : executeAssistantTool(tool, input, ctx)
}
