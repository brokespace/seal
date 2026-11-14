import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  MACHINE_IPC,
  type MachineShellEvent,
  type MachineShellOpenResult
} from '../../../shared/machines/machine-types'
import type { MachineShell } from '../connection/machine-connection'
import { machineIdOf, requireString, type MachineInvokeRegistrar } from '../machine-ipc-args'
import { getMachineRegistry } from '../registry/machine-registry-service'
import { buildMachineAgentCommand } from '../work/machine-agent-launch'

// Agents that read their first prompt from the terminal get it once their UI has drawn and gone quiet.
const FOLLOWUP_QUIET_MS = 800

type Session = { shell: MachineShell; owner: number }

const sessions = new Map<string, Session>()
const watchedOwners = new Set<number>()

function clampSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000
    ? value
    : fallback
}

function closeOwnedBy(owner: number): void {
  for (const [id, session] of sessions) {
    if (session.owner === owner) {
      sessions.delete(id)
      session.shell.close()
    }
  }
}

/** Machine terminals cannot reattach after their window reloads or closes. */
function watchOwner(sender: WebContents): void {
  if (watchedOwners.has(sender.id)) {
    return
  }
  watchedOwners.add(sender.id)
  const owner = sender.id
  sender.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      closeOwnedBy(owner)
    }
  })
  sender.on('render-process-gone', () => closeOwnedBy(owner))
  sender.once('destroyed', () => {
    watchedOwners.delete(owner)
    closeOwnedBy(owner)
  })
}

export function registerMachineShellHandlers(
  handle: MachineInvokeRegistrar,
  send: (channel: string, payload: MachineShellEvent) => void
): void {
  handle(MACHINE_IPC.shellOpen, async (args, event): Promise<MachineShellOpenResult> => {
    const machineId = machineIdOf(args.machineId)
    const connection = getMachineRegistry().connection(machineId)
    try {
      await connection.connect()
      const agent =
        typeof args.agent === 'string' && args.agent
          ? buildMachineAgentCommand(
              args.agent,
              typeof args.prompt === 'string' ? args.prompt : '',
              await connection.dialect()
            )
          : null
      const command =
        agent?.command ?? (typeof args.command === 'string' && args.command ? args.command : null)
      const sessionId = randomUUID()
      const emit = (payload: MachineShellEvent): void => send(MACHINE_IPC.shellEvent, payload)
      let followup = agent?.followupPrompt ?? null
      let followupTimer: ReturnType<typeof setTimeout> | null = null
      const scheduleFollowup = (): void => {
        if (!followup) {
          return
        }
        if (followupTimer) {
          clearTimeout(followupTimer)
        }
        followupTimer = setTimeout(() => {
          const text = followup
          followup = null
          if (text) {
            sessions.get(sessionId)?.shell.write(`${text}\r`)
          }
        }, FOLLOWUP_QUIET_MS)
      }
      const shell = await connection.openShell(
        {
          cols: clampSize(args.cols, 80),
          rows: clampSize(args.rows, 24),
          ...(typeof args.cwd === 'string' && args.cwd ? { cwd: args.cwd } : {}),
          ...(command ? { command } : {})
        },
        {
          onData: (data) => {
            emit({ sessionId, kind: 'data', data })
            scheduleFollowup()
          },
          onExit: (exitCode) => {
            if (followupTimer) {
              clearTimeout(followupTimer)
            }
            sessions.delete(sessionId)
            emit({ sessionId, kind: 'exit', exitCode })
          }
        }
      )
      sessions.set(sessionId, { shell, owner: event.sender.id })
      watchOwner(event.sender)
      return { ok: true, sessionId, transport: connection.transport }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  handle(MACHINE_IPC.shellWrite, (args) => {
    const data = typeof args.data === 'string' ? args.data : ''
    sessions.get(requireString(args.sessionId, 'sessionId'))?.shell.write(data)
  })

  handle(MACHINE_IPC.shellResize, (args) => {
    sessions
      .get(requireString(args.sessionId, 'sessionId'))
      ?.shell.resize(clampSize(args.cols, 80), clampSize(args.rows, 24))
  })

  handle(MACHINE_IPC.shellClose, (args) => {
    const sessionId = requireString(args.sessionId, 'sessionId')
    const session = sessions.get(sessionId)
    sessions.delete(sessionId)
    session?.shell.close()
  })
}
