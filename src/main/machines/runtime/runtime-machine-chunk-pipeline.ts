/** Slices in flight per file; hides one RPC round-trip per slice without flooding the runtime's call queue. */
export const RUNTIME_MACHINE_CHUNK_CONCURRENCY = 4

/** Visits `[0, total)` in `chunkSize` slices with bounded concurrency; stops every lane on the first failure. */
export async function forEachChunk(
  total: number,
  chunkSize: number,
  work: (offset: number, length: number) => Promise<void>,
  options: { concurrency?: number; signal?: AbortSignal } = {}
): Promise<void> {
  const lanes = Math.min(
    options.concurrency ?? RUNTIME_MACHINE_CHUNK_CONCURRENCY,
    Math.ceil(total / chunkSize)
  )
  let next = 0
  let failed = false
  const lane = async (): Promise<void> => {
    while (!failed && next < total) {
      options.signal?.throwIfAborted()
      const offset = next
      const length = Math.min(chunkSize, total - offset)
      next += length
      try {
        await work(offset, length)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane))
}
