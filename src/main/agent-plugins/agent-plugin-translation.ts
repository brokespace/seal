import { agentPluginView } from '../../shared/agent-plugins/agent-plugin-ledger'
import {
  planAgentPlugin,
  withPluginRoot,
  type AgentPluginAgentPlan
} from '../../shared/agent-plugins/agent-plugin-plan'
import { targetsIncludeSystemAccount } from '../../shared/agent-plugins/agent-plugin-targets'
import type {
  AgentPluginAgentState,
  AgentPluginRecord
} from '../../shared/agent-plugins/agent-plugin-types'
import { joinRelative } from '../agent-config/agent-config-locations'
import { writeMcpEntries } from '../agent-config/agent-config-mcp-entries'
import { patchSettings } from '../agent-config/agent-config-settings-ops'
import { errorText, runStep, setNativeEnabled, type AgentPluginRun } from './agent-plugin-native'
import { linkSkillFolder, unlinkSkillFolder } from './agent-plugin-skill-links'

/** Takes out every server and link Seal wrote for the plugin; nothing else is touched. */
export async function undoTranslations(
  run: AgentPluginRun,
  record: AgentPluginRecord
): Promise<void> {
  for (const state of record.agents) {
    if (state.mcpServers.length > 0) {
      await runStep(run, `${state.agent}: remove MCP servers`, () =>
        writeMcpEntries(run.connection, {
          target: { machineId: run.connection.machineId, agent: state.agent },
          scope: 'user',
          add: {},
          remove: state.mcpServers.map((server) => server.name)
        })
      )
    }
    for (const skill of state.skills.filter((item) => !item.via && item.path)) {
      await runStep(run, `${state.agent}: unlink ${skill.name}`, () =>
        unlinkSkillFolder(run.connection, skill.path)
      )
    }
  }
}

async function translateMcp(
  run: AgentPluginRun,
  record: AgentPluginRecord,
  state: AgentPluginAgentState
): Promise<void> {
  const written = await writeMcpEntries(run.connection, {
    target: { machineId: run.connection.machineId, agent: state.agent },
    scope: 'user',
    add: Object.fromEntries(
      Object.entries(record.provides.mcpServers).map(([name, entry]) => [
        name,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: substituting strings inside an object keeps it an object.
        withPluginRoot(entry, record.root) as Record<string, unknown>
      ])
    ),
    remove: []
  })
  state.mcpServers = written.written.map((name) => ({ name, path: written.path }))
  state.skipped.push(
    ...written.skipped.map((name) => `MCP server "${name}": one with that name is already set up`)
  )
}

async function linkSkills(
  run: AgentPluginRun,
  record: AgentPluginRecord,
  state: AgentPluginAgentState,
  skillsDir: string,
  forSystemLogin: boolean
): Promise<void> {
  for (const skill of record.provides.skills) {
    const link = joinRelative(run.home, `${skillsDir}/${skill.name}`)
    if ((await linkSkillFolder(run.connection, skill.directory, link)) === 'linked') {
      state.skills.push({ name: skill.name, path: link })
    } else {
      state.skipped.push(`Skill "${skill.name}": a skill with that name is already there`)
    }
  }
  if (state.agent === 'claude' && state.skills.length > 0) {
    // Account profiles read the same folder; the machine's own login says on or off here.
    await patchSettings(run.connection, {
      target: { machineId: run.connection.machineId, agent: 'claude' },
      scope: 'user',
      edits: state.skills.map((skill) =>
        forSystemLogin
          ? { path: ['skillOverrides', skill.name], remove: true as const }
          : { path: ['skillOverrides', skill.name], value: 'off' }
      )
    })
  }
}

async function translateFor(
  run: AgentPluginRun,
  record: AgentPluginRecord,
  plan: AgentPluginAgentPlan
): Promise<AgentPluginAgentState> {
  const state: AgentPluginAgentState = {
    agent: plan.agent,
    mode: plan.mode,
    mcpServers: [],
    skills: [],
    notApplicable: plan.notApplicable,
    skipped: []
  }
  if (plan.mode !== 'translated' || !record.enabled) {
    return state
  }
  // Claude Code and Codex account homes copy these files from the machine's own login.
  const provider = plan.agent === 'claude' || plan.agent === 'codex' ? plan.agent : null
  const forSystemLogin = provider === null || targetsIncludeSystemAccount(record.targets, provider)
  try {
    if (plan.mcpServers && forSystemLogin) {
      await translateMcp(run, record, state)
    }
    if (plan.skillsVia) {
      const via = plan.skillsVia
      state.skills = record.provides.skills.map((skill) => ({ name: skill.name, path: '', via }))
    } else if (plan.skillsDir) {
      await linkSkills(run, record, state, plan.skillsDir, forSystemLogin)
    }
  } catch (error) {
    state.error = errorText(error)
  }
  return state
}

/** Brings one machine in line with the record: native switches, then each other agent's copy. */
export async function applyRecord(
  run: AgentPluginRun,
  record: AgentPluginRecord
): Promise<AgentPluginAgentState[]> {
  for (const listing of record.listings) {
    await setNativeEnabled(run, record, listing)
  }
  const plans = planAgentPlugin({
    native: record.listings.map((listing) => listing.harness),
    components: agentPluginView(record).components,
    presentAgents: run.present,
    agents: record.targets.agents
  })
  const states: AgentPluginAgentState[] = []
  for (const plan of plans) {
    states.push(await translateFor(run, record, plan))
  }
  return states
}
