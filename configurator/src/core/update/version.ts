const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-dev)?$/

function parts(version: string): number[] | null {
  const match = VERSION.exec(version)
  return match ? match.slice(1).map(Number) : null
}

/**
 * Negative when `a` is older than `b`, zero when they are the same, positive when `a` is newer.
 * A version is three numbers; a `-dev` suffix adds nothing. A text that is not a version compares as equal to anything.
 */
export function compareVersions(a: string, b: string): number {
  const left = parts(a)
  const right = parts(b)
  if (!left || !right) return 0
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}
