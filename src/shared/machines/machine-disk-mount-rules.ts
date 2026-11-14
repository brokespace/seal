/** Mount points a person would not recognise as a disk: firmware, per-container and system volumes. */
const HIDDEN_MOUNT_PREFIXES = [
  '/dev',
  '/run',
  '/sys',
  '/proc',
  '/snap/',
  '/var/snap/',
  '/boot/efi',
  '/var/lib/docker/',
  '/var/lib/kubelet/',
  '/private/var/vm',
  '/System/Volumes/'
]

export function isHiddenDiskMount(mount: string): boolean {
  return HIDDEN_MOUNT_PREFIXES.some(
    (prefix) => mount === prefix.replace(/\/$/, '') || mount.startsWith(prefix)
  )
}

/** The disk a path is on: the mount with the longest matching prefix. */
export function diskMountOfPath<T extends { mount: string }>(
  mounts: readonly T[],
  path: string | null
): T | null {
  let best: T | null = null
  for (const mount of mounts) {
    const prefix = mount.mount.endsWith('/') ? mount.mount : `${mount.mount}/`
    const inside = path === mount.mount || (path ?? '').startsWith(prefix)
    if (inside && (best === null || mount.mount.length > best.mount.length)) {
      best = mount
    }
  }
  return best
}
