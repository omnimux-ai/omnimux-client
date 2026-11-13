/** Compare dotted hub versions. Pre-release is lower than the same numbers. */

/**
 * @param {string} version
 */
function parts(version) {
  const [core, pre] = version.split('-', 2)
  const [major, minor, patch] = core.split('.').map((value) => Number(value))
  return { major, minor, patch, pre: pre ?? '' }
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareSemver(left, right) {
  const a = parts(left)
  const b = parts(right)
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}
