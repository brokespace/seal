import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { HomeChatMachine } from '../machines/home-chat-machine-types'

const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024
const MAX_INLINE_BYTES = 25 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg'
}

export type HomeChatAttachmentInfo = {
  attachmentId: string
  name: string
  mimeType: string
  size: number
}

export function attachmentMimeType(name: string): string {
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

const safe = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file'

/** Copies of files the assistant showed the user, kept per chat under Seal's data folder. */
export class HomeChatAttachments {
  private readonly dir: string

  constructor(rootDir: string) {
    this.dir = join(rootDir, 'attachments')
  }

  async importFrom(
    machine: HomeChatMachine,
    chatId: string,
    path: string,
    name?: string
  ): Promise<HomeChatAttachmentInfo> {
    const fileName = safe(name?.trim() || path.replaceAll('\\', '/').split('/').pop() || 'file')
    const attachmentId = randomUUID()
    const folder = join(this.dir, safe(chatId))
    await mkdir(folder, { recursive: true })
    const target = join(folder, `${attachmentId}-${fileName}`)
    try {
      await (machine.info.kind === 'local'
        ? copyFile(path, target)
        : machine.downloadTo(path, target))
      const { size } = await stat(target)
      if (size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `${fileName} is ${size} bytes; attachments are limited to ${MAX_ATTACHMENT_BYTES}.`
        )
      }
      return { attachmentId, name: fileName, mimeType: attachmentMimeType(fileName), size }
    } catch (error) {
      await rm(target, { force: true })
      throw error
    }
  }

  async pathOf(chatId: string, attachmentId: string): Promise<string> {
    const folder = join(this.dir, safe(chatId))
    const prefix = `${safe(attachmentId)}-`
    const file = (await readdir(folder).catch(() => [])).find((entry) => entry.startsWith(prefix))
    if (!file) {
      throw new Error('This attachment is no longer available.')
    }
    return join(folder, file)
  }

  /** Bytes for inline display (images and small text). */
  async read(chatId: string, attachmentId: string): Promise<{ mimeType: string; base64: string }> {
    const path = await this.pathOf(chatId, attachmentId)
    const { size } = await stat(path)
    if (size > MAX_INLINE_BYTES) {
      throw new Error('Too large to show inline; save it instead.')
    }
    return { mimeType: attachmentMimeType(path), base64: (await readFile(path)).toString('base64') }
  }

  async saveAs(chatId: string, attachmentId: string, destination: string): Promise<void> {
    await copyFile(await this.pathOf(chatId, attachmentId), destination)
  }

  async deleteChat(chatId: string): Promise<void> {
    await rm(join(this.dir, safe(chatId)), { recursive: true, force: true })
  }
}
