import { createHash } from 'node:crypto'
import { expect } from '@stablyai/playwright-test'
import { quotePosixShell } from '../../../src/shared/shell/launch/shell-argument-quoting'
import type { ToolOutcome } from '../helpers/home-chat-tool-driver'
import { WORK_DIR, type Target, type ToolEnv } from './tool-case-types'

export const q = quotePosixShell

/** The scratch folder on a machine, created on first use. */
export function workDir(target: Target): string {
  const dir = `${target.home}/${WORK_DIR}`
  target.sh(`mkdir -p ${q(dir)}`)
  return dir
}

export function seedFile(target: Target, path: string, data: Buffer | string): void {
  target.sh(`mkdir -p "$(dirname ${q(path)})" && cat > ${q(path)}`, data)
}

export function readBack(target: Target, path: string): Buffer {
  return target.sh(`cat ${q(path)}`)
}

export function exists(target: Target, path: string): boolean {
  return (
    target
      .sh(`[ -e ${q(path)} ] && echo yes || echo no`)
      .toString()
      .trim() === 'yes'
  )
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Every byte value, repeated: catches any step that treats file content as text. */
export function binaryBlob(bytes: number): Buffer {
  return Buffer.from(Array.from({ length: bytes }, (_, index) => (index * 7 + (index >> 8)) % 256))
}

export function expectOk(outcome: ToolOutcome | undefined): string {
  expect(outcome, 'the tool call produced no result').toBeDefined()
  expect(outcome!.status, outcome!.text).toBe('ok')
  return outcome!.text
}

export function expectError(outcome: ToolOutcome | undefined): string {
  expect(outcome, 'the tool call produced no result').toBeDefined()
  expect(outcome!.status, outcome!.text).toBe('error')
  return outcome!.text
}

export function jobIdIn(text: string): string {
  const id = /background job (\w+)/.exec(text)?.[1]
  expect(id, `no job id in: ${text}`).toBeTruthy()
  return id!
}

/** A machine other than this one that is reached over SSH, as the far end of a copy or hop. */
export function sshPeerOf(env: ToolEnv, target: Target): Target {
  const peer = env.targets.find(
    (candidate) => candidate.key.startsWith('ssh-') && candidate.key !== target.key
  )
  if (!peer) {
    throw new Error('The suite needs at least two SSH machines')
  }
  return peer
}

/** Tools that only make sense together (start a worker, then check it) share one run per suite. */
export function sharedFlow<T>(run: (env: ToolEnv) => Promise<T>): (env: ToolEnv) => Promise<T> {
  const flows = new WeakMap<ToolEnv, Promise<T>>()
  return (env) => {
    let flow = flows.get(env)
    if (!flow) {
      flow = run(env)
      flows.set(env, flow)
    }
    return flow
  }
}

/** A turn Seal started by itself (a routine, a finished worker) has ended once the thread is idle. */
export async function waitUntilIdle(env: ToolEnv, chatId: string): Promise<void> {
  await expect
    .poll(
      () =>
        env.page.evaluate(
          async (chat) => (await window.api.homeChat!.get({ chatId: chat }))?.status,
          chatId
        ),
      { timeout: 60_000 }
    )
    .toBe('idle')
}
