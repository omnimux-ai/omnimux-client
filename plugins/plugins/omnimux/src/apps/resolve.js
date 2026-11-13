/** Choose bundled, disk, or in-memory catalog. A newer bundled floor drops stale cache. */

import { compareSemver } from './semver.js'

/**
 * @param {{
 *   bundled: { generated_at: string, min_hub: string },
 *   disk?: { generated_at: string, min_hub: string },
 *   memory?: { generated_at: string, min_hub: string },
 *   hubVersion: string,
 * }} input
 */
export function resolveCatalog(input) {
  const drop = []
  const keep = [{ kind: 'bundled', catalog: input.bundled }]
  for (const [kind, catalog] of [['disk', input.disk], ['memory', input.memory]]) {
    if (!catalog) continue
    if (compareSemver(catalog.min_hub, input.hubVersion) > 0) {
      drop.push({ kind, reason: 'min_hub' })
      continue
    }
    if (Date.parse(catalog.generated_at) < Date.parse(input.bundled.generated_at)) {
      drop.push({ kind, reason: 'older_than_bundled' })
      continue
    }
    keep.push({ kind, catalog })
  }
  keep.sort((left, right) => {
    const delta = Date.parse(right.catalog.generated_at) - Date.parse(left.catalog.generated_at)
    if (delta !== 0) return delta
    const rank = { memory: 0, disk: 1, bundled: 2 }
    return rank[left.kind] - rank[right.kind]
  })
  const winner = keep[0]
  return {
    catalog: winner.catalog,
    source: winner.kind === 'memory' ? 'remote' : winner.kind === 'disk' ? 'cache' : 'bundled',
    drop,
  }
}
