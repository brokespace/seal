import { app } from 'electron'

export const ARTIFACT_CLOUD_UNCONFIGURED_MESSAGE =
  'Cloud sharing is not available in Seal unless ORCA_ARTIFACTS_API_URL is set.'

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

/** Seal ships no hosted share service; null means sharing is unavailable. */
export function findArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string | null {
  const candidate = override?.trim() || env.ORCA_ARTIFACTS_API_URL?.trim()
  if (!candidate) {
    return null
  }
  const url = new URL(candidate)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !packaged)) {
    throw new Error('Artifact API URLs must use HTTPS; local development may use loopback HTTP.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Artifact API URL must be an origin without credentials, paths, or parameters.')
  }
  return url.origin
}

export function resolveArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string {
  const url = findArtifactCloudApiUrl(override, env, packaged)
  if (!url) {
    throw new Error(ARTIFACT_CLOUD_UNCONFIGURED_MESSAGE)
  }
  return url
}

export function allowsArtifactCloudAuthOverride(
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): boolean {
  return env.NODE_ENV !== 'production' && !packaged
}
