import { useCallback, useEffect, useState } from 'react'
import type {
  AgentConfigAgentId,
  AgentConfigAgentPresence,
  AgentConfigSnapshot
} from '../../../../../shared/agent-config/agent-config-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { agentConfigApi, agentConfigErrorText } from './agent-config-client'

// Reopening the page lands on the agent last looked at for that machine or project.
const lastAgent = new Map<string, AgentConfigAgentId>()

export type AgentConfigSnapshotState = {
  agents: AgentConfigAgentPresence[]
  agent: AgentConfigAgentId
  setAgent: (agent: AgentConfigAgentId) => void
  snapshot: AgentConfigSnapshot | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAgentConfigSnapshot(
  machineId: MachineId,
  online: boolean,
  projectPath: string | undefined
): AgentConfigSnapshotState {
  const memoryKey = `${machineId}\n${projectPath ?? ''}`
  const [agents, setAgents] = useState<AgentConfigAgentPresence[]>([])
  const [agent, setAgentState] = useState<AgentConfigAgentId>(
    () => lastAgent.get(memoryKey) ?? 'claude'
  )
  const [snapshot, setSnapshot] = useState<AgentConfigSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    if (!online) {
      return
    }
    let cancelled = false
    void Promise.resolve()
      .then(() => agentConfigApi().agents({ machineId, ...(projectPath ? { projectPath } : {}) }))
      .then((found) => {
        if (cancelled) {
          return
        }
        setAgents(found)
        // Start on an agent that is actually there, unless the person already chose one.
        if (!lastAgent.has(memoryKey)) {
          const present =
            found.find((item) => item.installed) ?? found.find((item) => item.configured)
          if (present) {
            setAgentState(present.agent)
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [machineId, memoryKey, online, projectPath])

  useEffect(() => {
    if (!online) {
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.resolve()
      .then(() =>
        agentConfigApi().snapshot({
          target: { machineId, agent, ...(projectPath ? { projectPath } : {}) }
        })
      )
      .then(
        (result) => {
          if (!cancelled) {
            setSnapshot(result)
            setError(null)
            setLoading(false)
          }
        },
        (failure: unknown) => {
          if (!cancelled) {
            setError(agentConfigErrorText(failure))
            setLoading(false)
          }
        }
      )
    return () => {
      cancelled = true
    }
  }, [agent, machineId, online, projectPath, token])

  const setAgent = useCallback(
    (next: AgentConfigAgentId) => {
      lastAgent.set(memoryKey, next)
      setSnapshot(null)
      setAgentState(next)
    },
    [memoryKey]
  )
  const reload = useCallback(() => setToken((value) => value + 1), [])

  return {
    agents,
    agent,
    setAgent,
    // A snapshot of another agent or place must never be shown under this one's name.
    snapshot:
      snapshot && snapshot.target.agent === agent && snapshot.target.machineId === machineId
        ? snapshot
        : null,
    loading,
    error,
    reload
  }
}
