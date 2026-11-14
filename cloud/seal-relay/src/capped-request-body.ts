/** A sender that stalls mid-body may not hold a request open past this. */
export const BODY_READ_DEADLINE_MS = 10_000

/**
 * The request body as text, or null once it passes `maxBytes` or stalls. The declared length is a
 * hint a sender can omit or lie about, so the limit is counted while reading and nothing past it
 * is kept.
 */
export async function readCappedBody(
  request: Request,
  maxBytes: number,
  deadlineMs = BODY_READ_DEADLINE_MS
): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) {
    return null
  }
  if (!request.body) {
    return ''
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let late = false
  const deadline = setTimeout(() => {
    late = true
    void reader.cancel().catch(() => {})
  }, deadlineMs)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (late) {
        return null
      }
      if (done) {
        break
      }
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    clearTimeout(deadline)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
