import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planAgentBinary } from '../../shared/agent-launch/startup/agent-command-plan'
import { getCommitMessageAgentSpec } from '../../shared/source-control/ai/generation/commit-message-agent-spec'
import type { CommitMessagePlan } from '../../shared/source-control/ai/generation/commit-message-plan'
import { AGENT_CLI_DEFAULT_MODEL } from '../../shared/utility-model/utility-model-provider-catalog'
import type {
  UtilityModelCatalogEntry,
  UtilityModelFailureKind,
  UtilityModelRequest
} from '../../shared/utility-model/utility-model-types'
import { GROK_TEXT_TASK_ENV, grokTextTaskPlan } from '../grok/grok-text-task'
import { getManagedDataAccountService } from '../managed-data-accounts/service'
import {
  commandBackslashMode,
  runGenerationRequest
} from '../text-generation/agent-generation-request'
import { discoverCommitMessageModelsLocal } from '../text-generation/commit-message-text-generation'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentEnvironmentResolvers
} from '../text-generation/execution/commit-message-agent-environment'
import { spawnSourceControlAgent } from '../text-generation/execution/source-control-agent-launch'
import { cancelLocalGeneration } from '../text-generation/execution/source-control-generation-lanes'
import { runLocalPlanForAgent } from '../text-generation/execution/source-control-local-generation'
import type {
  InternalTextGenerationResult,
  LocalGenerationTarget
} from '../text-generation/source-control-text-generation-types'
import { clipProviderText } from './utility-model-http-request'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'

export const AGENT_CLI_UTILITY_AGENTS = ['claude', 'codex', 'grok', 'antigravity', 'devin'] as const
export type AgentCliUtilityAgent = (typeof AGENT_CLI_UTILITY_AGENTS)[number]

export type AgentCliUtilityRun = (input: {
  agent: AgentCliUtilityAgent
  model: string
  prompt: string
  target: LocalGenerationTarget
  commandOverride: string | undefined
}) => Promise<InternalTextGenerationResult>

export type AgentCliUtilityDeps = {
  /** The account each agent's CLI runs on: the one Seal's own chats and commit messages use. */
  environment: () => CommitMessageAgentEnvironmentResolvers | undefined
  /** Settings > Agents command override for this agent. */
  commandOverride: (agent: AgentCliUtilityAgent) => string | undefined
  run?: AgentCliUtilityRun
  /** Extra environment for agents whose account is a data folder Seal manages. */
  accountEnvironment?: (agent: AgentCliUtilityAgent) => Record<string, string>
}

const LABELS: Record<AgentCliUtilityAgent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  antigravity: 'Antigravity',
  devin: 'Devin'
}

// One folder for every run, so the agent reads no project and keeps one history bucket.
const runFolder = (): string => join(tmpdir(), 'seal-utility-model')

/** A CLI takes one prompt, not a message list: the system text leads, and the reply is asked for bare. */
export function agentCliPrompt(request: UtilityModelRequest): string {
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
  const turns = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) =>
      message.role === 'assistant' ? `Your earlier reply:\n${message.content}` : message.content
    )
  return [
    'Answer with the requested text only. Do not use tools, read files, or ask questions.',
    ...system,
    ...turns
  ].join('\n\n')
}

function devinTextTaskPlan(input: {
  command: string
  prefixArgs: readonly string[]
  prompt: string
  model?: string
}): CommitMessagePlan {
  const args = [
    ...input.prefixArgs,
    '-p',
    // Print mode otherwise stops on an untrusted folder; this one is empty and Seal's own.
    '--respect-workspace-trust',
    'false',
    ...(input.model ? ['--model', input.model] : []),
    '--prompt-file',
    '{text-task-prompt}'
  ]
  return {
    binary: input.command,
    args,
    label: LABELS.devin,
    stdinPayload: null,
    taskFiles: [{ name: 'text-task-prompt.txt', content: input.prompt, argIndex: args.length - 1 }]
  }
}

/** Agents with a commit-message recipe reuse it; Grok and Devin have their own print-mode plan. */
const runAgentCli: AgentCliUtilityRun = async ({
  agent,
  model,
  prompt,
  target,
  commandOverride
}) => {
  if (getCommitMessageAgentSpec(agent)) {
    return await runGenerationRequest({
      params: { agentId: agent, model, agentCommandOverride: commandOverride },
      prompt,
      target,
      operation: 'utility-completion',
      spawnAgent: spawnSourceControlAgent
    })
  }
  const command = planAgentBinary(agent, commandOverride, commandBackslashMode(target))
  if (!command.ok) {
    return { success: false, error: command.error }
  }
  const plan = { command: command.binary, prefixArgs: command.prefixArgs, prompt }
  const named = model === AGENT_CLI_DEFAULT_MODEL ? {} : { model }
  return await runLocalPlanForAgent({
    agentId: agent,
    plan: {
      ...(agent === 'grok'
        ? grokTextTaskPlan({ ...plan, ...named, sessionId: randomUUID() })
        : devinTextTaskPlan({ ...plan, ...named })),
      ...(command.env ? { env: command.env } : {})
    },
    target,
    operation: 'utility-completion',
    spawnAgent: spawnSourceControlAgent
  })
}

const FAILURE_PATTERNS: readonly [UtilityModelFailureKind, RegExp][] = [
  [
    'rate-limited',
    /rate.?limit|usage limit|limit reached|quota|too many requests|\b429\b|overloaded/i
  ],
  [
    'unauthorized',
    /\b(log|sign) ?in\b|\/login|not (logged|signed) in|unauthori[sz]ed|authenticat|invalid api key|\b401\b|credentials/i
  ],
  [
    'model-not-found',
    /(model|--model).{0,60}(not found|does not exist|not supported|not available|unknown|invalid)|(unknown|invalid|unsupported) model/i
  ]
]

/** A CLI reports failures in prose; the class is read from its words, and the words are kept for the person. */
function failureOf(
  agent: AgentCliUtilityAgent,
  model: string,
  failure: Extract<InternalTextGenerationResult, { success: false }>
): UtilityModelError {
  const detail = { model }
  if (
    failure.errorCode === 'agentBinaryNotFound' ||
    failure.errorCode === 'agentCouldNotStart' ||
    failure.errorCode === 'agentFailedToStart'
  ) {
    return new UtilityModelError('not-configured', failure.error, detail)
  }
  if (failure.errorCode === 'timedOut') {
    return new UtilityModelError('network', `${LABELS[agent]} did not answer in time`, detail)
  }
  const output = `${failure.failureOutput?.stderr ?? ''}\n${failure.failureOutput?.stdout ?? ''}\n${failure.errorDetail ?? ''}`
  const kind = FAILURE_PATTERNS.find(([, pattern]) => pattern.test(output))?.[0] ?? 'bad-response'
  return new UtilityModelError(kind, clipProviderText(failure.error), detail)
}

let queue: Promise<unknown> = Promise.resolve()

/** One CLI at a time on this host: each run is a whole agent process on the user's subscription. */
function inTurn<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

function managedAccountEnvironment(agent: AgentCliUtilityAgent): Record<string, string> {
  if (agent === 'grok') {
    return { ...GROK_TEXT_TASK_ENV }
  }
  return agent === 'devin' ? getManagedDataAccountService().launchEnvironment('devin') : {}
}

/**
 * A utility model served by an agent's own CLI in print mode: no key to save, but every request
 * starts a process and spends the subscription the user's real sessions run on.
 */
export function createAgentCliUtilityProvider(
  agent: AgentCliUtilityAgent,
  deps: AgentCliUtilityDeps
): UtilityModelProvider {
  const run = deps.run ?? runAgentCli
  const accountEnvironment = deps.accountEnvironment ?? managedAccountEnvironment
  const environment = async (model?: string): Promise<NodeJS.ProcessEnv | undefined> => {
    const prepared = await prepareLocalCommitMessageAgentEnv(agent, deps.environment())
    if (!prepared.ok) {
      throw new UtilityModelError('unauthorized', prepared.error, model ? { model } : {})
    }
    const extra = accountEnvironment(agent)
    return Object.keys(extra).length > 0
      ? { ...(prepared.env ?? process.env), ...extra }
      : prepared.env
  }

  return {
    id: agent,
    complete: (model, request, signal) =>
      inTurn(async () => {
        signal?.throwIfAborted()
        const env = await environment(model)
        const cwd = runFolder()
        await mkdir(cwd, { recursive: true })
        // Runs share the folder, so each gets its own cancel lane.
        const laneId = randomUUID()
        const cancel = (): void => cancelLocalGeneration('utility-completion', cwd, laneId)
        signal?.addEventListener('abort', cancel, { once: true })
        try {
          const result = await run({
            agent,
            model,
            prompt: agentCliPrompt(request),
            target: { kind: 'local', cwd, laneId, ...(env ? { env } : {}) },
            commandOverride: deps.commandOverride(agent)
          })
          signal?.throwIfAborted()
          if (!result.success) {
            throw failureOf(agent, model, result)
          }
          return result.rawOutput
        } finally {
          signal?.removeEventListener('abort', cancel)
        }
      }),
    async listModels() {
      const fallback: UtilityModelCatalogEntry[] = [
        { id: AGENT_CLI_DEFAULT_MODEL, description: null }
      ]
      if (agent === 'devin') {
        return fallback
      }
      const found = await discoverCommitMessageModelsLocal(
        agent,
        await environment(),
        deps.commandOverride(agent)
      )
      if (!found.success) {
        throw new UtilityModelError(
          found.unavailable ? 'not-configured' : 'bad-response',
          clipProviderText(found.error)
        )
      }
      return found.models.map((model) => ({ id: model.id, description: model.label }))
    }
  }
}
