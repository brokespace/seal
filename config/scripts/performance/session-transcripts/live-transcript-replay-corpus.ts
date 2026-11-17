// An image-heavy Claude Code transcript in the record shapes the CLI writes: pasted screenshots,
// screenshots a tool read back, and prompts queued with an image while the agent was busy.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../../../..')
const IMAGE_FOLDERS = ['resources/onboarding/feature-wall', 'docs/assets/readme-features']
const MEDIA_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif'
}

export type ImageHeavyTranscriptOptions = {
  /** Each turn is a pasted screenshot, a screenshot read back by a tool, and their replies. */
  turns?: number
  sessionId?: string
  cwd?: string
}

type Image = { name: string; mediaType: string; base64: string; bytes: number }

function repoImages(): Image[] {
  return IMAGE_FOLDERS.flatMap((folder) =>
    readdirSync(join(REPO_ROOT, folder))
      .filter((name) => MEDIA_TYPES[extname(name)] !== undefined)
      .sort()
      .map((name) => {
        const bytes = readFileSync(join(REPO_ROOT, folder, name))
        return {
          name,
          mediaType: MEDIA_TYPES[extname(name)],
          base64: bytes.toString('base64'),
          bytes: bytes.byteLength
        }
      })
  )
}

const PROSE = [
  'The header overlaps the sidebar at narrow widths; the grid template needs a minmax on the first track.',
  'I compared the screenshot against the layout tokens and the gap is one step too small on the card row.',
  'The toolbar wraps because the button group has no shrink rule, so the last action drops to a second line.',
  'That matches what the screenshot shows: the status pill is clipped by the overflow on its parent.'
]

/** Writes the transcript and returns its path. */
export function writeImageHeavyClaudeTranscript(
  path: string,
  options: ImageHeavyTranscriptOptions = {}
): string {
  const turns = options.turns ?? 72
  const sessionId = options.sessionId ?? '7d1c3a52-8f0e-4c55-9a43-2b6f1e0d9c11'
  const cwd = options.cwd ?? '/home/brian/app'
  const images = repoImages()
  const lines: string[] = []
  let sequence = 0
  let parent: string | null = null
  const record = (fields: Record<string, unknown>): void => {
    sequence++
    const uuid = `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`
    lines.push(
      JSON.stringify({
        parentUuid: parent,
        isSidechain: false,
        userType: 'external',
        cwd,
        sessionId,
        version: '2.1.0',
        gitBranch: 'main',
        uuid,
        timestamp: new Date(Date.UTC(2026, 10, 16, 9, 0, sequence * 20)).toISOString(),
        ...fields
      })
    )
    parent = uuid
  }
  const user = (content: unknown, extra: Record<string, unknown> = {}): void =>
    record({ type: 'user', message: { role: 'user', content }, ...extra })
  const assistant = (content: unknown[]): void =>
    record({
      type: 'assistant',
      message: {
        id: `msg_${sequence}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        content,
        stop_reason: content.some((block) => (block as { type: string }).type === 'tool_use')
          ? 'tool_use'
          : 'end_turn',
        usage: { input_tokens: 1200, output_tokens: 240 }
      }
    })
  const imageBlock = (image: Image): unknown => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.base64 }
  })

  for (let turn = 0; turn < turns; turn++) {
    const pasted = images[turn % images.length]
    const read = images[(turn * 7 + 3) % images.length]
    const pastedPath = `${cwd}/shots/${turn}-${pasted.name}`
    const prose = PROSE[turn % PROSE.length]

    user([
      { type: 'text', text: `[Image #1] Screen ${turn + 1}: what is wrong with this layout?` },
      imageBlock(pasted)
    ])
    user([{ type: 'text', text: `[Image: source: ${pastedPath}]` }], { isMeta: true })

    const toolUseId = `toolu_${turn.toString().padStart(6, '0')}`
    const readPath = `${cwd}/screens/${turn}-${read.name}`
    assistant([
      { type: 'text', text: `Let me look at the current render. ${prose}` },
      { type: 'tool_use', id: toolUseId, name: 'Read', input: { file_path: readPath } }
    ])
    user([{ type: 'tool_result', tool_use_id: toolUseId, content: [imageBlock(read)] }], {
      toolUseResult: {
        type: 'image',
        file: { base64: read.base64, type: read.mediaType, originalSize: read.bytes }
      }
    })
    assistant([{ type: 'text', text: `${prose} ${prose}` }])

    if (turn % 4 === 3) {
      const queued = images[(turn * 5 + 1) % images.length]
      record({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          commandMode: 'prompt',
          origin: { kind: 'human' },
          prompt: [{ type: 'text', text: 'Also compare it with this one.' }, imageBlock(queued)]
        }
      })
      assistant([{ type: 'text', text: `Compared both. ${prose}` }])
    }

    user(`Thanks, apply that fix to screen ${turn + 1} and keep going.`)
    assistant([{ type: 'text', text: `Applied. ${prose}` }])
  }

  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}
