import { useCallback, useEffect, useRef, useState } from 'react'
import { readIpcErrorDetail } from '@/runtime/errors/ipc-error'
import type { AgentConnectorsSnapshot } from '../../../../shared/agent-connectors/agent-connector-types'
import type { MachineId } from '../../../../shared/machines/machine-types'

export type AgentConnectorsState = {
  snapshot: AgentConnectorsSnapshot | null
  /** Every account is being checked. */
  checking: boolean
  /** Accounts being re-checked on their own, after a sign-in. */
  checkingAccounts: ReadonlySet<string>
  error: string | null
  refresh: () => void
  refreshAccount: (accountId: string) => Promise<void>
}

export function agentConnectorsApi(): NonNullable<typeof window.api.agentConnectors> | null {
  return typeof window !== 'undefined' ? (window.api?.agentConnectors ?? null) : null
}

export function agentConnectorsErrorText(error: unknown): string {
  return readIpcErrorDetail(error) ?? String(error)
}

type Reading = { snapshot: AgentConnectorsSnapshot } | { error: string }

async function readConnectors(args: {
  machineId: MachineId
  force?: boolean
  accountId?: string
}): Promise<Reading | null> {
  const api = agentConnectorsApi()
  if (!api) {
    return null
  }
  try {
    return { snapshot: await api.list(args) }
  } catch (caught) {
    return { error: agentConnectorsErrorText(caught) }
  }
}

/** One machine's connectors per account; the first read may take a minute (every server is contacted). */
export function useAgentConnectors(machineId: MachineId): AgentConnectorsState {
  const [snapshot, setSnapshot] = useState<AgentConnectorsSnapshot | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkingAccounts, setCheckingAccounts] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Answers for a machine the user has since moved away from are dropped.
  const shown = useRef(machineId)

  const apply = useCallback((reading: Reading | null) => {
    if (reading && 'error' in reading) {
      setError(reading.error)
    } else if (reading && reading.snapshot.machineId === shown.current) {
      setSnapshot(reading.snapshot)
    }
  }, [])

  const load = useCallback(
    async (force: boolean) => {
      setChecking(true)
      setError(null)
      apply(await readConnectors({ machineId, force }))
      setChecking(false)
    },
    [apply, machineId]
  )

  useEffect(() => {
    shown.current = machineId
    setSnapshot(null)
    void load(false)
  }, [load, machineId])

  const refreshAccount = useCallback(
    async (accountId: string) => {
      setCheckingAccounts((current) => new Set([...current, accountId]))
      apply(await readConnectors({ machineId, accountId }))
      setCheckingAccounts((current) => new Set([...current].filter((id) => id !== accountId)))
    },
    [apply, machineId]
  )

  return {
    snapshot,
    checking,
    checkingAccounts,
    error,
    refresh: () => void load(true),
    refreshAccount
  }
}
