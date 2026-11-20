import { splitMachineFolderInput } from '../../../shared/machines/machine-folder-input'
import { joinMachinePath } from '../../../shared/machines/machine-paths'
import type { MachineFolderCompletion } from '../../../shared/machines/machine-resource-types'
import type { MachineDirListing } from '../../../shared/machines/machine-types'

const MAX_MATCHES = 50
const MAX_PAGES = 10

type ListPage = (path: string, offset: number) => Promise<MachineDirListing>

/**
 * Folders under the typed path's parent whose names start with what is typed so far. An exact-case
 * match wins; otherwise case is ignored, so `proj` still finds `Projects`. Hidden folders appear
 * only once a dot is typed.
 */
export async function completeMachineFolder(
  listPage: ListPage,
  expandedInput: string
): Promise<MachineFolderCompletion> {
  const { parent, prefix } = splitMachineFolderInput(expandedInput)
  const names: string[] = []
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const listing = await listPage(parent, offset)
    for (const entry of listing.entries) {
      if (entry.isDirectoryLike && (prefix.startsWith('.') || !entry.name.startsWith('.'))) {
        names.push(entry.name)
      }
    }
    offset += listing.entries.length
    if (listing.entries.length === 0 || offset >= listing.totalEntries) {
      break
    }
  }
  const exact = names.filter((name) => name.startsWith(prefix))
  const lower = prefix.toLowerCase()
  const matched =
    exact.length > 0 ? exact : names.filter((name) => name.toLowerCase().startsWith(lower))
  return {
    parent,
    matches: matched
      .slice(0, MAX_MATCHES)
      .map((name) => ({ name, path: joinMachinePath(parent, name) })),
    truncated: matched.length > MAX_MATCHES
  }
}
