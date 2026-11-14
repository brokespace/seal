import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { MachineId } from '../../../shared/machines/machine-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { SshMachineLink } from '../connection/ssh-machine-link'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { removeDirectorySftp } from '../../ssh/file-transfer/sftp/sftp-upload'
import {
  isAllowedDownloadUrl,
  type MachineFileStat,
  type MachineFileSystem,
  type MachineTransferSession
} from './machine-filesystem'
import {
  parsePosixListDirOutput,
  posixListDirCommand,
  posixMkdirCommand,
  posixRemoveCommand,
  posixRenameCommand,
  posixStatCommand
} from './posix-machine-commands'
import {
  hasInotifyWait,
  runRemoteUrlDownload,
  startPosixInotifyWatch
} from './ssh-machine-remote-jobs'
import {
  isSftpNoSuchFile,
  isSftpStatusError,
  sftpEntry,
  sftpFastGet,
  sftpFastPut,
  sftpListDir,
  sftpLstat,
  sftpMkdirP,
  sftpReadHead,
  sftpRealpath,
  sftpRename,
  sftpStat,
  sftpUnlink,
  sftpWriteFile
} from './sftp-operations'

const LIST_TIMEOUT_MS = 30_000

function remoteBasename(target: string): string {
  return target.replace(/\/+$/, '').split('/').at(-1) ?? target
}

function remoteDirname(target: string): string {
  const trimmed = target.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

/** Browses one SSH host over a long-lived SFTP channel, or plain exec when the host uses system ssh. */
export class SshMachineFileSystem implements MachineFileSystem {
  private sftpChannel: {
    conn: SshMachineLink
    generation: number
    sftp: Promise<SFTPWrapper>
  } | null = null
  private inotifyAvailable: boolean | null = null

  constructor(
    readonly machineId: MachineId,
    private readonly link: () => SshMachineLink | null
  ) {}

  private connection(): SshMachineLink {
    const conn = this.link()
    if (!conn || conn.getState().status !== 'connected') {
      throw new Error('Machine is not connected')
    }
    return conn
  }

  private isWindowsHost(): boolean {
    return this.connection().getState().remotePlatform === 'win32'
  }

  private usesSftp(conn: SshMachineLink): boolean {
    return !conn.usesSystemSshTransport()
  }

  private persistentSftp(conn: SshMachineLink): Promise<SFTPWrapper> {
    const generation = conn.getConnectGeneration()
    const cached = this.sftpChannel
    if (cached && cached.conn === conn && cached.generation === generation) {
      return cached.sftp
    }
    const sftp = conn.sftp().then((channel) => {
      const drop = (): void => {
        if (this.sftpChannel?.sftp === sftp) {
          this.sftpChannel = null
        }
      }
      channel.once('close', drop)
      channel.once('end', drop)
      channel.on('error', drop)
      return channel
    })
    sftp.catch(() => {
      if (this.sftpChannel?.sftp === sftp) {
        this.sftpChannel = null
      }
    })
    this.sftpChannel = { conn, generation, sftp }
    return sftp
  }

  /** Runs on the shared SFTP channel, reopening it once when the channel (not the file) failed. */
  private async withSftp<T>(conn: SshMachineLink, operation: (sftp: SFTPWrapper) => Promise<T>) {
    try {
      return await operation(await this.persistentSftp(conn))
    } catch (error) {
      if (isSftpStatusError(error)) {
        throw error
      }
      this.sftpChannel = null
      return operation(await this.persistentSftp(conn))
    }
  }

  private exec(
    conn: SshMachineLink,
    command: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ) {
    return execCommand(conn, command, {
      timeoutMs: options?.timeoutMs ?? LIST_TIMEOUT_MS,
      signal: options?.signal
    })
  }

  async homeDir(): Promise<string> {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      return this.withSftp(conn, (sftp) => sftpRealpath(sftp, '.'))
    }
    return (await this.exec(conn, 'printf %s "$HOME"')).trim() || '/'
  }

  async listDir(dir: string) {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      return this.withSftp(conn, (sftp) => sftpListDir(sftp, dir))
    }
    return parsePosixListDirOutput(await this.exec(conn, posixListDirCommand(dir)))
  }

  async stat(target: string): Promise<MachineFileStat> {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      return this.withSftp(conn, async (sftp) => {
        const entry = sftpEntry(remoteBasename(target), await sftpLstat(sftp, target))
        if (entry.kind === 'symlink') {
          entry.isDirectoryLike = await sftpStat(sftp, target).then(
            (stats) => stats.isDirectory(),
            () => false
          )
        }
        return { ...entry, path: target }
      })
    }
    const [entry] = parsePosixListDirOutput(await this.exec(conn, posixStatCommand(target)))
    if (!entry) {
      throw new Error(`No such file: ${target}`)
    }
    return { ...entry, name: remoteBasename(target), path: target }
  }

  async readFile(target: string, maxBytes: number) {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      return this.withSftp(conn, (sftp) => sftpReadHead(sftp, target, maxBytes))
    }
    const { size } = await this.stat(target)
    // Without SFTP a partial read is a remote head into a temp file, fetched like a full preview.
    const headPath =
      size > maxBytes
        ? (
            await this.exec(
              conn,
              `t=$(mktemp) && head -c ${Math.floor(maxBytes)} -- ${quotePosixShell(target)} > "$t" && printf %s "$t"`
            )
          ).trim()
        : null
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'seal-machine-preview-'))
    try {
      const local = path.join(tempDir, 'preview')
      await conn.downloadFile(headPath ?? target, local)
      return { size, data: await readFile(local) }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
      if (headPath) {
        await this.exec(conn, `rm -f -- ${quotePosixShell(headPath)}`).catch(() => {})
      }
    }
  }

  async writeFile(target: string, data: Buffer): Promise<void> {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      await this.withSftp(conn, (sftp) => sftpWriteFile(sftp, target, data))
      return
    }
    await conn.writeBuffer(target, data)
  }

  async createDir(target: string): Promise<void> {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      await this.withSftp(conn, (sftp) => sftpMkdirP(sftp, target))
      return
    }
    await this.exec(conn, posixMkdirCommand(target))
  }

  async rename(from: string, to: string): Promise<void> {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      await this.withSftp(conn, async (sftp) => {
        const exists = await sftpLstat(sftp, to).then(
          () => true,
          (error) => (isSftpNoSuchFile(error) ? false : Promise.reject(error))
        )
        if (exists) {
          throw new Error('Destination already exists')
        }
        await sftpRename(sftp, from, to)
      })
      return
    }
    await this.exec(conn, posixRenameCommand(from, to))
  }

  async remove(target: string): Promise<void> {
    const conn = this.connection()
    if (!this.isWindowsHost()) {
      // One rm beats walking the tree request-by-request over SFTP.
      await this.exec(conn, posixRemoveCommand(target), { timeoutMs: 10 * 60 * 1000 })
      return
    }
    await this.withSftp(conn, async (sftp) => {
      const stats = await sftpLstat(sftp, target)
      await (stats.isDirectory() ? removeDirectorySftp(sftp, target) : sftpUnlink(sftp, target))
    })
  }

  async openTransferSession(signal: AbortSignal): Promise<MachineTransferSession> {
    const conn = this.connection()
    if (this.usesSftp(conn)) {
      // A dedicated channel lets cancel close it without disturbing browsing.
      const sftp = await conn.sftp(signal)
      const close = (): void => {
        try {
          sftp.end()
        } catch {}
      }
      signal.addEventListener('abort', close, { once: true })
      return {
        uploadFile: (localPath, remotePath, _size, onProgress) =>
          sftpFastPut(sftp, localPath, remotePath, onProgress),
        downloadFile: (remotePath, localPath, _size, onProgress) =>
          sftpFastGet(sftp, remotePath, localPath, onProgress),
        close
      }
    }
    const upload = await conn.openFileUploadSession()
    return {
      async uploadFile(localPath, remotePath, size, onProgress) {
        await upload.uploadFile(localPath, remotePath)
        onProgress(size)
      },
      async downloadFile(remotePath, localPath, size, onProgress) {
        await conn.downloadFile(remotePath, localPath)
        onProgress(size)
      },
      close: () => {
        void Promise.resolve(upload.close()).catch(() => {})
      }
    }
  }

  async downloadUrl(
    url: string,
    destination: string,
    onProgress: (transferred: number, total: number | null) => void,
    signal: AbortSignal
  ): Promise<void> {
    if (!isAllowedDownloadUrl(url)) {
      throw new Error('Only http and https URLs can be downloaded')
    }
    const conn = this.connection()
    await this.createDir(remoteDirname(destination))
    await runRemoteUrlDownload({
      conn,
      windows: this.isWindowsHost(),
      url,
      destination,
      onProgress,
      signal,
      stat: (target) => this.stat(target)
    })
  }

  async watch(dirs: string[], onChange: (dir: string) => void): Promise<(() => void) | null> {
    if (dirs.length === 0) {
      return () => {}
    }
    const conn = this.connection()
    if (this.isWindowsHost()) {
      return null
    }
    this.inotifyAvailable ??= await hasInotifyWait(conn)
    return this.inotifyAvailable ? startPosixInotifyWatch(conn, dirs, onChange) : null
  }
}
