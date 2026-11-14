import type {
  SealMcpAuditOutcome,
  SealMcpClient,
  SealMcpTransport
} from '../../../shared/seal-mcp/seal-mcp-types'
import { resolveHomeChatMachineId } from '../../home-chat/machines/home-chat-machine-provider'
import { LOCAL_MACHINE_ID } from '../../home-chat/machines/home-chat-machine-types'
import { optionalStr, type HomeChatToolResult } from '../../home-chat/tools/home-chat-tool-context'
import { executeHomeChatTool } from '../../home-chat/tools/home-chat-tool-executor'
import { failureReply, invalidArgumentsReply } from '../../home-chat/tools/home-chat-tool-replies'
import {
  assessHomeChatToolRisk,
  assessShellCommandRisk
} from '../../home-chat/tools/home-chat-tool-risk'
import type { SealMcpApprovals } from '../approvals/seal-mcp-approvals'
import { summarizeMcpToolArguments } from '../audit/seal-mcp-audit-summary'
import { executeSealMcpRpcTool } from './seal-mcp-rpc-tools'
import { scopeSealMcpToolRuntime, type SealMcpToolRuntime } from './seal-mcp-scoped-runtime'
import { pinSessionTargetToAllowedMachines } from './seal-mcp-session-target'
import {
  isSealMcpHomeChatTool,
  isSealMcpRpcTool,
  parseSealMcpToolInput,
  sealMcpToolSpec,
  type SealMcpToolRisk,
  type SealMcpToolSpec
} from './seal-mcp-tool-catalog'

const MAX_APPROVAL_SUMMARY_CHARS = 4_000

export type SealMcpCaller = {
  client: SealMcpClient
  transport: SealMcpTransport
  signal?: AbortSignal
}

/** What a tool call answered, and what the audit log should say about it. */
export type SealMcpToolOutcome = {
  text: string
  isError: boolean
  outcome: SealMcpAuditOutcome
  machine: string | null
  summary: string | null
  approved: boolean | null
  /** Why Seal refused or failed, for the audit log. Never a tool's own output, which may hold secrets. */
  detail: string | null
}

type Assessment = { risk: SealMcpToolRisk; reason: string }

const JOB_TOOLS: ReadonlySet<string> = new Set([
  'job_status',
  'job_output',
  'job_kill',
  'job_cleanup'
])

function assess(tool: string, spec: SealMcpToolSpec, input: Record<string, unknown>): Assessment {
  if (tool === 'run_command') {
    const shell = assessShellCommandRisk(String(input.command ?? ''))
    return shell.requiresApproval
      ? { risk: 'destructive', reason: shell.reason }
      : { risk: 'command', reason: 'This runs a shell command.' }
  }
  if (tool === 'stop_session') {
    return { risk: spec.risk, reason: 'This stops a running agent session.' }
  }
  const known = isSealMcpHomeChatTool(tool) ? assessHomeChatToolRisk(tool, input) : null
  return {
    risk: spec.risk,
    reason: known?.requiresApproval ? known.reason : 'This changes something on your machines.'
  }
}

function needsApproval(risk: SealMcpToolRisk, caller: SealMcpCaller): boolean {
  if (risk === 'destructive') {
    // The relay can read a client's token, so what it forwards never skips the person.
    return caller.client.approval !== 'never' || caller.transport === 'relay'
  }
  return risk === 'command' && caller.client.approval === 'commands'
}

function approvalSummary(tool: string, input: Record<string, unknown>): string {
  const shown =
    tool === 'run_command' ? String(input.command ?? '') : summarizeMcpToolArguments(input)
  return shown.length > MAX_APPROVAL_SUMMARY_CHARS
    ? `${shown.slice(0, MAX_APPROVAL_SUMMARY_CHARS)}…`
    : shown
}

/** The machine a call names that the client may not use, if any. */
async function deniedMachine(
  spec: SealMcpToolSpec,
  input: Record<string, unknown>,
  runtime: SealMcpToolRuntime,
  allowed: readonly string[] | null
): Promise<string | null> {
  if (!allowed || !spec.machineArgs) {
    return null
  }
  const all = await runtime.machines.list()
  const permitted = all.filter((machine) => allowed.includes(machine.id))
  for (const arg of spec.machineArgs) {
    const named = optionalStr(input[arg]) ?? (spec.defaultsToLocal ? LOCAL_MACHINE_ID : undefined)
    if (!named) {
      continue
    }
    let id: string
    try {
      id = resolveHomeChatMachineId(named, all)
    } catch {
      // Unknown or ambiguous: answer from the permitted machines only, so the rest stay unnamed.
      id = resolveHomeChatMachineId(named, permitted)
    }
    if (!allowed.includes(id)) {
      return named
    }
  }
  return null
}

export type SealMcpToolRunnerDeps = {
  runtime: () => Promise<SealMcpToolRuntime>
  approvals: Pick<SealMcpApprovals, 'request'>
}

/** Runs one MCP tool call: scopes, machine allowlist, approval, then the shared tool code. */
export class SealMcpToolRunner {
  constructor(private readonly deps: SealMcpToolRunnerDeps) {}

  async call(caller: SealMcpCaller, tool: string, rawInput: unknown): Promise<SealMcpToolOutcome> {
    const base = { machine: null, summary: null, approved: null, detail: null }
    const spec = sealMcpToolSpec(tool)
    const missing = spec?.scopes.filter((scope) => !caller.client.scopes.includes(scope)) ?? []
    // An unknown tool and one outside the client's scopes answer alike: it is not on offer.
    if (!spec || missing.length > 0) {
      return {
        ...base,
        text: `This MCP client has no tool "${tool}". tools/list shows what it may call.`,
        isError: true,
        outcome: spec ? 'scope-denied' : 'error',
        detail: spec ? `Needs the ${missing.join(' and ')} scope.` : 'Unknown tool.'
      }
    }
    let input: Record<string, unknown>
    try {
      input = parseSealMcpToolInput(spec, rawInput)
    } catch (error) {
      return {
        ...base,
        text: invalidArgumentsReply(tool, error),
        isError: true,
        outcome: 'error',
        detail: 'Invalid arguments.'
      }
    }
    const summary = summarizeMcpToolArguments(input)
    try {
      return await this.run(caller, tool, spec, input, summary)
    } catch (error) {
      return {
        ...base,
        summary,
        text: failureReply(tool, error),
        isError: true,
        outcome: 'error',
        detail: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async run(
    caller: SealMcpCaller,
    tool: string,
    spec: SealMcpToolSpec,
    input: Record<string, unknown>,
    summary: string
  ): Promise<SealMcpToolOutcome> {
    const { client } = caller
    const full = await this.deps.runtime()
    const refused = (
      outcome: SealMcpAuditOutcome,
      text: string,
      approved: boolean | null = null
    ): SealMcpToolOutcome => ({
      text,
      isError: true,
      outcome,
      machine: null,
      summary,
      approved,
      detail: text
    })

    const denied = await deniedMachine(spec, input, full, client.machines)
    if (denied) {
      return refused(
        'machine-denied',
        `This MCP client is not allowed to use the machine "${denied}". list_machines shows the machines it may use.`
      )
    }
    const { risk, reason } = assess(tool, spec, input)
    if (risk === 'destructive' && !client.scopes.includes('destructive')) {
      return refused(
        'scope-denied',
        `${reason} That needs the destructive scope, which this MCP client does not have. Do not work around it; ask the user.`
      )
    }
    const chatId = `mcp:${client.id}`
    const jobId = optionalStr(input.job_id)
    if (
      JOB_TOOLS.has(tool) &&
      jobId &&
      !full.services.jobs.list(chatId).some((j) => j.id === jobId)
    ) {
      return refused(
        'error',
        `No job ${jobId} was started by this client. job_status lists its jobs.`
      )
    }
    let approved: boolean | null = null
    if (needsApproval(risk, caller)) {
      approved = await this.deps.approvals.request(
        {
          clientId: client.id,
          clientName: client.name,
          transport: caller.transport,
          tool,
          machine: optionalStr(input.machine) ?? null,
          summary: approvalSummary(tool, input),
          reason
        },
        caller.signal
      )
      if (!approved) {
        return refused(
          'approval-denied',
          'The user did not approve this action in the Seal app. Do not retry it or work around it; ask how they want to proceed.',
          false
        )
      }
    }
    const runtime = scopeSealMcpToolRuntime(full, client.machines)
    let toolInput = input
    if (tool === 'start_session' && client.machines) {
      const pinned = await pinSessionTargetToAllowedMachines(input, runtime)
      if ('refusal' in pinned) {
        return refused('machine-denied', pinned.refusal)
      }
      toolInput = pinned.input
    }
    let result: HomeChatToolResult
    if (isSealMcpRpcTool(tool)) {
      result = await executeSealMcpRpcTool(tool, input, runtime, client.machines !== null)
    } else if (isSealMcpHomeChatTool(tool)) {
      result = await executeHomeChatTool(tool, toolInput, {
        chatId,
        machines: runtime.machines,
        runOrcaCli: runtime.runOrcaCli,
        services: runtime.services,
        reportProgress: () => {},
        showAttachment: () => {},
        signal: caller.signal
      })
    } else {
      return refused('error', `This MCP client has no tool "${tool}".`)
    }
    return {
      text: result.text,
      isError: result.isError,
      outcome: result.isError ? 'error' : 'ok',
      machine: result.machine ?? null,
      summary,
      approved,
      detail: null
    }
  }
}
