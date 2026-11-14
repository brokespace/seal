import { expect } from '@stablyai/playwright-test'
import {
  binaryBlob,
  exists,
  expectError,
  expectOk,
  readBack,
  seedFile,
  sha256,
  sshPeerOf,
  workDir
} from './tool-case-support'
import type { Target, ToolCases, ToolEnv } from './tool-case-types'

const TEXT = [
  'line "double" \'single\' `tick`',
  '$HOME ${not} $(not) \\n stays literal',
  'zażółć 日本語 🦭',
  '',
  '\ttabbed * ? [glob]',
  'last line without a newline'
].join('\n')

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

function largeText(): string {
  return Array.from({ length: 8000 }, (_, index) => `${index} "quoted" $x 日本語 ${'#'.repeat(30)}`)
    .join('\n')
    .concat('\n')
}

async function writeFile(env: ToolEnv, target: Target): Promise<void> {
  const dir = workDir(target)
  const note = `${dir}/write/deep/nested dir/note (1).txt`
  const large = largeText()
  const { outcomes } = await env.call([
    { name: 'write_file', args: { machine: target.machine, path: note, content: TEXT } },
    {
      name: 'write_file',
      args: { machine: target.machine, path: note, content: '\nappended ✓\n', append: true }
    },
    {
      name: 'write_file',
      args: { machine: target.machine, path: `${dir}/write/large.txt`, content: large }
    },
    {
      name: 'write_file',
      args: { machine: target.machine, path: '~/seal-e2e-tilde/tilde.txt', content: 'tilde\n' }
    },
    {
      name: 'write_file',
      args: { machine: target.machine, path: 'seal-e2e-relative/rel.txt', content: 'relative\n' }
    }
  ])
  expect(expectOk(outcomes[0])).toBe(`Wrote ${Buffer.byteLength(TEXT)} bytes to ${note}.`)
  expect(expectOk(outcomes[1])).toBe(`Appended 14 bytes to ${note}.`)
  expect(readBack(target, note).toString('utf8')).toBe(`${TEXT}\nappended ✓\n`)
  expectOk(outcomes[2])
  expect(sha256(readBack(target, `${dir}/write/large.txt`))).toBe(sha256(Buffer.from(large)))
  expect(expectOk(outcomes[3])).toBe(`Wrote 6 bytes to ${target.home}/seal-e2e-tilde/tilde.txt.`)
  expect(readBack(target, `${target.home}/seal-e2e-tilde/tilde.txt`).toString()).toBe('tilde\n')
  expectOk(outcomes[4])
  expect(readBack(target, `${target.home}/seal-e2e-relative/rel.txt`).toString()).toBe('relative\n')
}

async function readFile(env: ToolEnv, target: Target): Promise<void> {
  const dir = workDir(target)
  seedFile(target, `${dir}/read/text file.txt`, TEXT)
  seedFile(target, `${dir}/read/long.txt`, 'abcdefghij'.repeat(100))
  seedFile(target, `${dir}/read/blob.bin`, binaryBlob(4096))
  seedFile(target, `${target.home}/seal-e2e-read-tilde.txt`, 'from the home folder\n')
  const { outcomes } = await env.call([
    { name: 'read_file', args: { machine: target.machine, path: `${dir}/read/text file.txt` } },
    {
      name: 'read_file',
      args: { machine: target.machine, path: `${dir}/read/long.txt`, max_bytes: 25 }
    },
    { name: 'read_file', args: { machine: target.machine, path: '~/seal-e2e-read-tilde.txt' } },
    { name: 'read_file', args: { machine: target.machine, path: `${dir}/read/nope.txt` } },
    { name: 'read_file', args: { machine: target.machine, path: `${dir}/read` } },
    { name: 'read_file', args: { machine: target.machine, path: `${dir}/read/blob.bin` } }
  ])
  expect(expectOk(outcomes[0])).toBe(TEXT)
  expect(expectOk(outcomes[1])).toBe('abcdefghijabcdefghijabcde\n… [truncated at 25 bytes]')
  expect(expectOk(outcomes[2])).toBe('from the home folder\n')
  expect(expectError(outcomes[3])).toContain('read_file failed and did not complete')
  expect(expectError(outcomes[4])).toContain('read_file failed and did not complete')
  expect(expectError(outcomes[5])).toContain('is a binary file')
}

async function deletePath(env: ToolEnv, target: Target): Promise<void> {
  const dir = workDir(target)
  const file = `${dir}/delete/one file's "name".txt`
  const tree = `${dir}/delete/tree`
  const kept = `${dir}/delete/kept.txt`
  seedFile(target, file, 'x')
  seedFile(target, `${tree}/a/b/c.txt`, 'x')
  seedFile(target, `${tree}/top.txt`, 'x')
  seedFile(target, kept, 'x')
  seedFile(target, `${target.home}/seal-e2e-delete-tilde.txt`, 'x')

  const approved = await env.call([
    { name: 'delete_path', args: { machine: target.machine, path: file } },
    { name: 'delete_path', args: { machine: target.machine, path: tree } },
    { name: 'delete_path', args: { machine: target.machine, path: tree, recursive: true } },
    { name: 'delete_path', args: { machine: target.machine, path: '~/seal-e2e-delete-tilde.txt' } }
  ])
  expect(approved.outcomes.map((outcome) => outcome.askedApproval)).toEqual([
    true,
    true,
    true,
    true
  ])
  expect(expectOk(approved.outcomes[0])).toBe('exit code 0')
  expect(exists(target, file)).toBe(false)
  expect(expectError(approved.outcomes[1])).toContain('exit code 1')
  expectOk(approved.outcomes[2])
  expect(exists(target, tree)).toBe(false)
  expectOk(approved.outcomes[3])
  expect(exists(target, `${target.home}/seal-e2e-delete-tilde.txt`)).toBe(false)

  const declined = await env.call(
    [{ name: 'delete_path', args: { machine: target.machine, path: kept } }],
    { approve: false }
  )
  expect(declined.outcomes[0].status).toBe('denied')
  expect(declined.outcomes[0].text).toContain('The user declined this action.')
  expect(exists(target, kept)).toBe(true)
}

async function attachFile(env: ToolEnv, target: Target): Promise<void> {
  const dir = workDir(target)
  seedFile(target, `${dir}/attach/pixel one.png`, PNG)
  const { outcomes, chatId } = await env.call([
    { name: 'attach_file', args: { machine: target.machine, path: `${dir}/attach/pixel one.png` } }
  ])
  expect(expectOk(outcomes[0])).toBe(
    `Showed pixel_one.png (image/png, ${PNG.length} bytes) to the user.`
  )
  const shown = await env.page.evaluate(async (chat) => {
    const entries = (await window.api.homeChat!.get({ chatId: chat }))?.entries ?? []
    const attachment = entries.find((entry) => entry.kind === 'attachment')
    if (!attachment || attachment.kind !== 'attachment') {
      return null
    }
    const data = await window.api.homeChat!.readAttachment({
      chatId: chat,
      attachmentId: attachment.attachmentId
    })
    return { machine: attachment.machine, ...data }
  }, chatId)
  expect(shown).toEqual({
    machine: target.label,
    mimeType: 'image/png',
    base64: PNG.toString('base64')
  })
}

async function transferFile(env: ToolEnv, target: Target): Promise<void> {
  const local = env.targets[0]
  const peer = sshPeerOf(env, target)
  const blob = binaryBlob(300_000)
  const digest = sha256(blob)
  const dir = workDir(target)
  const localDir = `${workDir(local)}/transfer-${target.key}`
  const peerDir = `${workDir(peer)}/transfer-from-${target.key}`
  seedFile(target, `${dir}/transfer/src blob.bin`, blob)
  seedFile(target, `${dir}/transfer/tree/a/one.txt`, 'one\n')
  seedFile(target, `${dir}/transfer/tree/b b/two.bin`, blob.subarray(0, 5000))
  seedFile(local, `${localDir}/up.bin`, blob)
  const pushes = target.key !== 'local'

  const { outcomes } = await env.call(
    [
      {
        name: 'transfer_file',
        args: {
          from_machine: 'local',
          from_path: `${localDir}/up.bin`,
          to_machine: target.machine,
          to_path: `${dir}/transfer/in/from local.bin`
        }
      },
      {
        name: 'transfer_file',
        args: {
          from_machine: target.machine,
          from_path: `${dir}/transfer/src blob.bin`,
          to_machine: 'local',
          to_path: `${localDir}/down/back.bin`
        }
      },
      {
        name: 'transfer_file',
        args: {
          from_machine: target.machine,
          from_path: `${dir}/transfer/src blob.bin`,
          to_machine: peer.machine,
          to_path: `${peerDir}/auto.bin`
        }
      },
      {
        name: 'transfer_file',
        args: {
          from_machine: target.machine,
          from_path: `${dir}/transfer/src blob.bin`,
          to_machine: peer.machine,
          to_path: `${peerDir}/relay.bin`,
          method: 'relay'
        }
      },
      {
        name: 'transfer_file',
        args: {
          from_machine: target.machine,
          from_path: `${dir}/transfer/tree`,
          to_machine: peer.machine,
          to_path: `${peerDir}/tree-copy`,
          recursive: true,
          method: 'direct'
        }
      }
    ],
    { timeoutMs: 240_000 }
  )
  expectOk(outcomes[0])
  expect(sha256(readBack(target, `${dir}/transfer/in/from local.bin`))).toBe(digest)
  expectOk(outcomes[1])
  expect(sha256(readBack(local, `${localDir}/down/back.bin`))).toBe(digest)

  // Only a remote machine can push; from this computer the copy is an upload.
  expect(expectOk(outcomes[2])).toContain(pushes ? 'directly' : 'Copied')
  expect(sha256(readBack(peer, `${peerDir}/auto.bin`))).toBe(digest)
  expect(expectOk(outcomes[3])).not.toContain('directly')
  expect(sha256(readBack(peer, `${peerDir}/relay.bin`))).toBe(digest)

  if (pushes) {
    expectOk(outcomes[4])
    expect(readBack(peer, `${peerDir}/tree-copy/a/one.txt`).toString()).toBe('one\n')
    expect(sha256(readBack(peer, `${peerDir}/tree-copy/b b/two.bin`))).toBe(
      sha256(blob.subarray(0, 5000))
    )
  } else {
    expect(expectError(outcomes[4])).toContain('A direct push needs a POSIX source machine')
  }
}

export const FILE_TOOL_CASES: ToolCases = {
  write_file: { scope: 'each-machine', run: writeFile },
  read_file: { scope: 'each-machine', run: readFile },
  delete_path: { scope: 'each-machine', run: deletePath },
  attach_file: { scope: 'each-machine', run: attachFile },
  transfer_file: { scope: 'each-machine', run: transferFile }
}
