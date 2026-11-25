// Dependency-free: the relay Worker and the hosts key their per-source limits with it.

const IPV4_MAPPED_PREFIX = /^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i

/**
 * The key a per-source limit counts under. An IPv6 caller is keyed by its /64, which one subscriber
 * usually holds whole, so rotating addresses inside it buys no fresh budget.
 */
export function sourceAddressKey(address: string | null | undefined): string {
  const ip = (address ?? '').trim().replace(IPV4_MAPPED_PREFIX, '')
  if (!ip.includes(':')) {
    return ip || 'unknown'
  }
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = ip.includes('::') && tail ? tail.split(':') : []
  const groups = ip.includes('::')
    ? [
        ...left,
        ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0'),
        ...right
      ]
    : left
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}
