import { joinMachinePath } from '../../../../shared/machines/machine-paths'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { findReadmeName } from './project-overview-model'
import { useProjectOverviewLoad, type ProjectOverviewLoad } from './use-project-overview-load'

const README_MAX_BYTES = 64 * 1024
/** A README changes rarely and is read over the machine's connection, so it is re-read slowly. */
const README_LIVE_MS = 15_000

export type ProjectReadme = { path: string; text: string; truncated: boolean }

/** The project's README, read from the machine that holds it and kept live. Null when it has none. */
export function useProjectReadme(
  machineId: MachineId | null,
  projectPath: string
): ProjectOverviewLoad<ProjectReadme | null> {
  const api = window.api.machines
  const key = machineId && api ? `${machineId}\n${projectPath}` : null
  return useProjectOverviewLoad(
    key,
    async () => {
      if (!machineId || !api) {
        return null
      }
      // A cached listing is a read behind: a README added or deleted would show one round late.
      const listing = await api.listDir({ machineId, path: projectPath, force: true })
      const name = findReadmeName(
        listing.entries.filter((entry) => !entry.isDirectoryLike).map((entry) => entry.name)
      )
      if (!name) {
        return null
      }
      const path = joinMachinePath(projectPath, name)
      const file = await api.readFile({ machineId, path, maxBytes: README_MAX_BYTES })
      const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0))
      return { path, text: new TextDecoder().decode(bytes), truncated: file.truncated }
    },
    README_LIVE_MS
  )
}
