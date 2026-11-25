import { useCallback, useSyncExternalStore } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { MachineDockerContainers } from '../../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

/** `docker stats --no-stream` takes about two seconds on the machine. */
const REFRESH_MS = 5_000

type ContainerPoll = {
  docker: MachineDockerContainers | null
  listeners: Set<() => void>
  sampling: boolean
  /** A reload asked for while a sample was under way; it runs as soon as that one lands. */
  stale: boolean
  stop: () => void
}

// One poll per machine however many views show its containers, so they all read the same sample.
const polls = new Map<MachineId, ContainerPoll>()

async function listContainers(machineId: MachineId): Promise<MachineDockerContainers> {
  try {
    return await machineResourceApi().listDockerContainers({ machineId })
  } catch (err) {
    return { state: 'unreachable', reason: 'other', message: resourceErrorText(err) }
  }
}

function sample(machineId: MachineId, poll: ContainerPoll): void {
  if (poll.sampling) {
    return
  }
  poll.sampling = true
  poll.stale = false
  void listContainers(machineId).then((docker) => {
    poll.sampling = false
    if (polls.get(machineId) !== poll) {
      return
    }
    poll.docker = docker
    for (const listener of poll.listeners) {
      listener()
    }
    if (poll.stale) {
      sample(machineId, poll)
    }
  })
}

function subscribe(machineId: MachineId, listener: () => void): () => void {
  let poll = polls.get(machineId)
  if (!poll) {
    const created: ContainerPoll = {
      docker: null,
      listeners: new Set(),
      sampling: false,
      stale: false,
      stop: () => {}
    }
    polls.set(machineId, created)
    created.stop = installWindowVisibilityInterval({
      run: () => sample(machineId, created),
      intervalMs: REFRESH_MS
    })
    poll = created
  }
  const subscribed = poll
  subscribed.listeners.add(listener)
  return () => {
    subscribed.listeners.delete(listener)
    if (subscribed.listeners.size === 0) {
      subscribed.stop()
      polls.delete(machineId)
    }
  }
}

function reloadContainers(machineId: MachineId): void {
  const poll = polls.get(machineId)
  if (poll) {
    poll.stale = true
    sample(machineId, poll)
  }
}

const subscribeToNothing = (): (() => void) => () => {}

export type MachineDockerContainersState = {
  /** Null until the first sample lands. */
  docker: MachineDockerContainers | null
  /** Samples again at once, e.g. after a container was stopped. */
  reload: () => void
}

/** A machine's containers with their `docker stats` figures, sampled while a view showing them is open. */
export function useMachineDockerContainers(
  machineId: MachineId,
  enabled = true
): MachineDockerContainersState {
  const subscribeToMachine = useCallback(
    (listener: () => void) => subscribe(machineId, listener),
    [machineId]
  )
  const docker = useSyncExternalStore(enabled ? subscribeToMachine : subscribeToNothing, () =>
    enabled ? (polls.get(machineId)?.docker ?? null) : null
  )
  const reload = useCallback(() => reloadContainers(machineId), [machineId])
  return { docker, reload }
}
