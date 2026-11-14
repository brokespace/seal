import type { PseudoTtyOptions, SFTPWrapper } from 'ssh2'
import type { SshConnectionState } from '../../../shared/ssh-types'
import type {
  RemoteCommandChannel,
  RemoteInstallTransport
} from '../../managed-server/install/remote-install-transport'
import type { SshRemoteFileOptions } from '../../ssh/file-transfer/ssh-connection-file-transfers'

export type SshShellChannel = RemoteCommandChannel & {
  setWindow(rows: number, cols: number, height: number, width: number): void
}

/** The part of an SSH connection machine features use; `SshConnection` is one. */
export type SshMachineLink = Pick<
  RemoteInstallTransport,
  'exec' | 'execWithClosedStdin' | 'usesSystemSshTransport' | 'getConnectGeneration'
> & {
  getState(): Pick<SshConnectionState, 'status' | 'remotePlatform'>
  sftp(signal?: AbortSignal): Promise<SFTPWrapper>
  /** Interactive login shell; ssh2 transport only. */
  shell(pty: PseudoTtyOptions): Promise<SshShellChannel>
  writeBuffer(
    remotePath: string,
    contents: Buffer,
    options?: SshRemoteFileOptions & { append?: boolean }
  ): Promise<void>
  downloadFile(remotePath: string, localPath: string, options?: SshRemoteFileOptions): Promise<void>
  openFileUploadSession(options?: SshRemoteFileOptions): Promise<{
    uploadFile(localPath: string, remotePath: string): Promise<void>
    close(): void | Promise<void>
  }>
}
