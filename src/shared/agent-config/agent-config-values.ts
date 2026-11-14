export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isDate(value)
}

function isDate(value: unknown): value is Date {
  return value instanceof Date
}

/** Deep copy that keeps TOML dates as they are; `structuredClone` would turn them into plain dates. */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a copy of an array has the array's own element types.
    return value.map(cloneValue) as T
  }
  if (isPlainObject(value)) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a copy of an object has the object's own keys and value types.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    ) as T
  }
  return value
}

/** Structural equality for parsed config values; object key order does not matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (isDate(a) || isDate(b)) {
    return isDate(a) && isDate(b) && String(a) === String(b)
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    )
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false
  }
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
  )
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out[key] = String(item)
    }
  }
  return out
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' || typeof item === 'number').map(String)
    : []
}

/** The value at a dotted-free path of keys, or undefined when any step is missing. */
export function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let node = root
  for (const key of path) {
    if (!isPlainObject(node)) {
      return undefined
    }
    node = node[key]
  }
  return node
}
