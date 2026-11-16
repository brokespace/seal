import { rm, stat } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  DISK_INDEX_PROTOCOL,
  type MachineDiskIndexReply,
  type MachineDiskIndexRequest
} from '../../../shared/machines/machine-disk-index-types'
import { errnoCodeOrUnknown } from '../../../shared/errors/errno-code'

const MAX_REQUEST_BYTES = 64 * 1024

export type DiskIndexEnvelope = {
  protocol: number
  request: MachineDiskIndexRequest
}

/** `superseded` tells a caller with a newer protocol that this daemon is stepping aside for it. */
export type DiskIndexDaemonReply = MachineDiskIndexReply | { ok: false; superseded: true }

export function diskIndexSocketPath(dataDir: string): string {
  return join(dataDir, 'daemon.sock')
}

/** One request, one reply, newline-delimited JSON. Rejects when no daemon is listening. */
export function requestDiskIndexDaemon(
  socketPath: string,
  request: MachineDiskIndexRequest,
  timeoutMs: number
): Promise<DiskIndexDaemonReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let received = ''
    socket.setEncoding('utf8')
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('The disk index did not answer.')))
    socket.on('connect', () => {
      const envelope: DiskIndexEnvelope = { protocol: DISK_INDEX_PROTOCOL, request }
      socket.write(`${JSON.stringify(envelope)}\n`)
    })
    socket.on('data', (chunk: string) => {
      received += chunk
    })
    socket.on('error', reject)
    socket.on('end', () => {
      try {
        const reply: DiskIndexDaemonReply = JSON.parse(received)
        resolve(reply)
      } catch {
        reject(new Error('The disk index sent an unreadable reply.'))
      }
    })
  })
}

function serve(
  socket: Socket,
  handle: (envelope: DiskIndexEnvelope) => Promise<DiskIndexDaemonReply>
): void {
  let received = ''
  let answered = false
  socket.setEncoding('utf8')
  socket.on('error', () => socket.destroy())
  socket.on('data', (chunk: string) => {
    received += chunk
    if (answered || (!received.includes('\n') && received.length <= MAX_REQUEST_BYTES)) {
      return
    }
    answered = true
    void Promise.resolve()
      .then(() => {
        const envelope: DiskIndexEnvelope = JSON.parse(received.slice(0, received.indexOf('\n')))
        return handle(envelope)
      })
      .catch((error: unknown): DiskIndexDaemonReply => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }))
      .then((reply) => socket.end(`${JSON.stringify(reply)}\n`))
  })
}

const SUPERSEDED_EXIT_WAIT_MS = 200

async function isAnswering(socketPath: string): Promise<boolean> {
  const reply = await requestDiskIndexDaemon(socketPath, { op: 'status' }, 5000).catch(() => null)
  if (reply && 'superseded' in reply) {
    await new Promise((resolve) => setTimeout(resolve, SUPERSEDED_EXIT_WAIT_MS))
    return false
  }
  return reply !== null
}

export type DiskIndexListener = {
  /** False once another daemon has replaced the socket file, so this one should stop. */
  stillOwnsSocket(): Promise<boolean>
}

/**
 * Binding the socket is what makes this the machine's one daemon. Resolves null when another
 * daemon already holds it.
 */
export async function listenForDiskIndexRequests(
  socketPath: string,
  handle: (envelope: DiskIndexEnvelope) => Promise<DiskIndexDaemonReply>
): Promise<DiskIndexListener | null> {
  const listen = (): Promise<Server> =>
    new Promise((resolve, reject) => {
      const server = createServer((socket) => serve(socket, handle))
      server.once('error', reject)
      server.listen(socketPath, () => resolve(server))
    })
  try {
    await listen()
  } catch (error) {
    if (errnoCodeOrUnknown(error) !== 'EADDRINUSE') {
      throw error
    }
    if (await isAnswering(socketPath)) {
      return null
    }
    // A daemon that was killed leaves its socket file behind.
    await rm(socketPath, { force: true })
    await listen()
  }
  const inode = (await stat(socketPath)).ino
  return {
    stillOwnsSocket: () =>
      stat(socketPath).then(
        (current) => current.ino === inode,
        () => false
      )
  }
}
