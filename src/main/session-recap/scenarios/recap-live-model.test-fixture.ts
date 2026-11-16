// The real Workers AI endpoint, for a recording run only: replay never reaches it.
import type { UtilityModelFetch } from '../../utility-model/utility-model-http-request'

const ATTEMPTS = 4
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Asked again when the service is busy or down. Without that the pipeline would move on to its
 * fallback model, and the recording would hold the fallback's reply where replay asks the first model.
 */
export const askLiveRecapModel: UtilityModelFetch = async (url, init) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, init).catch(() => null)
    const answered = response !== null && response.status < 500 && response.status !== 429
    if (answered || attempt === ATTEMPTS || init.signal?.aborted) {
      if (response === null) {
        throw new Error('Workers AI could not be reached')
      }
      return response
    }
    await pause(2000 * 2 ** (attempt - 1))
  }
}
