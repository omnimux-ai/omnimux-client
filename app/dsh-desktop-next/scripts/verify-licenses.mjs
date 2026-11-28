/**
 * Verify every production dependency shipped inside the desktop installers
 * carries a permissive license that allows redistribution.
 *
 * Walks the production dependency graph (dependencies + optionalDependencies,
 * excluding dev/peer) starting from this package manifest. First-party OmniMux
 * workspace-linked plugins (`link:../../plugins/plugins/...`, covered by the
 * root AGPL-3.0-only NOTICE) are skipped. Fails when a third-party package has
 * no license field and no LICENSE file, or when its license is not on the
 * redistribution allowlist.
 *
 * @module scripts/verify-licenses
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const rootManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const FIRST_PARTY_PLUGIN_PREFIX = 'link:../../plugins/plugins/'
const FIRST_PARTY_PLUGINS_DIR = resolve(packageRoot, '..', '..', 'plugins', 'plugins')

/**
 * Identify first-party OmniMux workspace plugins linked from `<repo>/plugins/plugins/<name>`.
 */
export function isFirstPartyWorkspacePlugin(name, rangeOrResolvedPath) {
  if (name !== 'omnimux' && !name.startsWith('omnimux-')) return false
  if (typeof rangeOrResolvedPath !== 'string' || rangeOrResolvedPath.length === 0) return false
  if (rangeOrResolvedPath === `${FIRST_PARTY_PLUGIN_PREFIX}${name}`) return true
  const rawPluginRoot = resolve(FIRST_PARTY_PLUGINS_DIR, name)
  const pluginRoot = existsSync(rawPluginRoot) ? realpathSync(rawPluginRoot) : rawPluginRoot
  const rawCandidate = resolve(packageRoot, rangeOrResolvedPath)
  const candidate = existsSync(rawCandidate) ? realpathSync(rawCandidate) : rawCandidate
  return candidate === pluginRoot || candidate.startsWith(`${pluginRoot}${sep}`)
}

/** Licenses accepted for redistribution inside the desktop installers. */
const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
  'CC0-1.0',
  'Zlib',
  'Python-2.0',
  'BlueOak-1.0.0',
])

/**
 * Licenses that permit redistribution only when their notice obligations are
 * honored. Sharp ships libvips as a separate @img/sharp-libvips-* package on
 * macOS and inside the @img/sharp-win32-* package on Windows. Their license
 * texts ship inside node_modules in the installer. Keep this list minimal and
 * review any addition.
 */
const NOTICE_LICENSES = new Set([
  'LGPL-3.0-or-later',
])

/**
 * Parse a parenthesized SPDX boolean expression (`AND` binds tighter than `OR`).
 * Returns null for empty or syntactically invalid expressions.
 */
function parseSpdxExpression(license) {
  if (typeof license !== 'string') return null
  const tokens = license.match(/\(|\)|[^\s()]+/gu)
  if (!tokens || tokens.length === 0) return null
  let pos = 0

  function parseOr() {
    let left = parseAnd()
    if (left === null) return null
    while (pos < tokens.length && /^OR$/iu.test(tokens[pos])) {
      pos += 1
      const right = parseAnd()
      if (right === null) return null
      left = { kind: 'or', left, right }
    }
    return left
  }

  function parseAnd() {
    let left = parsePrimary()
    if (left === null) return null
    while (pos < tokens.length && /^AND$/iu.test(tokens[pos])) {
      pos += 1
      const right = parsePrimary()
      if (right === null) return null
      left = { kind: 'and', left, right }
    }
    return left
  }

  function parsePrimary() {
    const token = tokens[pos]
    if (token === undefined) return null
    if (token === '(') {
      pos += 1
      const inner = parseOr()
      if (inner === null || tokens[pos] !== ')') return null
      pos += 1
      return inner
    }
    if (token === ')' || /^(?:AND|OR)$/iu.test(token)) return null
    pos += 1
    return { kind: 'leaf', id: token }
  }

  const ast = parseOr()
  return ast !== null && pos === tokens.length ? ast : null
}

function evalAst(node, onLeaf, onAnd, onOr) {
  if (node.kind === 'leaf') return onLeaf(node.id)
  if (node.kind === 'and') return onAnd(evalAst(node.left, onLeaf, onAnd, onOr), evalAst(node.right, onLeaf, onAnd, onOr))
  return onOr(evalAst(node.left, onLeaf, onAnd, onOr), evalAst(node.right, onLeaf, onAnd, onOr))
}

/**
 * Accept one SPDX identifier or an AND/OR expression whose leaves are all
 * on the redistribution or notice allowlists.
 */
export function licenseAccepted(license) {
  const ast = parseSpdxExpression(license)
  if (ast === null) return false
  return evalAst(
    ast,
    id => ALLOWED_LICENSES.has(id) || NOTICE_LICENSES.has(id),
    (left, right) => left && right,
    (left, right) => left && right,
  )
}

/**
 * Check whether an SPDX license requires a notice-obligated term across every
 * satisfying selection (`AND` propagates requirement, `OR` requires it only if
 * all alternatives require notice).
 */
export function licenseNeedsNotice(license) {
  const ast = parseSpdxExpression(license)
  if (ast === null) return false
  return evalAst(
    ast,
    id => NOTICE_LICENSES.has(id),
    (left, right) => left || right,
    (left, right) => left && right,
  )
}

/**
 * Locate one installed package manifest by walking node_modules directories
 * upward from the parent manifest. Reads the real package.json regardless of
 * the package's `exports` map, which often hides the `./package.json` subpath.
 */
function resolvePackageManifest(name, fromManifestPath) {
  const segments = name.split('/')
  const folder = name.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  const entry = name.startsWith('@') ? segments.slice(2).join('/') : segments.slice(1).join('/')
  let dir = dirname(fromManifestPath)
  for (;;) {
    const candidate = join(dir, 'node_modules', folder, entry, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Normalize the license field of one package manifest. */
function licenseExpression(manifest) {
  const value = manifest.license
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && typeof value.type === 'string') return value.type
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((item) => (typeof item === 'string' ? item : item.type))
      .filter(Boolean)
      .join(' OR ')
  }
  return undefined
}

function runCli() {
  const failures = []
  const seen = new Set()
  const manifests = []
  const queue = [{ name: rootManifest.name ?? 'dsh-desktop-next', manifestPath: join(packageRoot, 'package.json') }]

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (current === undefined || seen.has(current.name)) continue
    seen.add(current.name)
    if (isFirstPartyWorkspacePlugin(current.name, current.manifestPath)) continue
    const manifest = JSON.parse(readFileSync(current.manifestPath, 'utf8'))

    if (current.name !== rootManifest.name) {
      const license = licenseExpression(manifest)
      const hasLicenseFile = existsSync(join(dirname(current.manifestPath), 'LICENSE'))
        || existsSync(join(dirname(current.manifestPath), 'LICENSE.md'))
        || existsSync(join(dirname(current.manifestPath), 'LICENSE.txt'))
      if (license === undefined && !hasLicenseFile) {
        failures.push(`${current.name}: no license field and no LICENSE file`)
      } else if (license !== undefined && license.startsWith('SEE LICENSE IN ')) {
        if (!hasLicenseFile) {
          failures.push(`${current.name}: license refers to ${JSON.stringify(license)} but no LICENSE file is shipped`)
        }
      } else if (license !== undefined && !licenseAccepted(license)) {
        failures.push(`${current.name}: license ${JSON.stringify(license)} is not on the redistribution allowlist`)
      }
      manifests.push({ name: current.name, version: manifest.version, license: license ?? 'SEE LICENSE FILE' })
    }

    const requireFrom = createRequire(current.manifestPath)
    void requireFrom
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (isFirstPartyWorkspacePlugin(name, range)) continue
        const resolved = resolvePackageManifest(name, current.manifestPath)
        if (isFirstPartyWorkspacePlugin(name, resolved)) continue
        if (resolved === undefined) {
          // Optional dependencies may legitimately be absent on this platform.
          if (section === 'optionalDependencies') continue
          failures.push(`${current.name} -> ${name}: could not locate its manifest`)
          continue
        }
        queue.push({ name, manifestPath: resolved })
      }
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`verify-licenses: ${failures.length} production package(s) need attention\n`)
    for (const failure of failures) process.stderr.write(`- ${failure}\n`)
    process.exit(1)
  }

  const noticeOnly = manifests.filter(entry => licenseNeedsNotice(entry.license))
  const noticesArg = process.argv.indexOf('--notices')
  if (noticesArg !== -1) {
    const target = process.argv[noticesArg + 1]
    if (target === undefined) {
      process.stderr.write('verify-licenses: --notices requires a file path\n')
      process.exit(1)
    }
    const lines = [
      '# Third-Party Notices',
      '',
      'OmniMux distributes the following third-party packages inside its installers.',
      'Each package ships with its own license text in the application files; this list records',
      'the package names, versions, and licenses for transparency.',
      '',
      '| Package | Version | License |',
      '| --- | --- | --- |',
      ...manifests
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(entry => `| ${entry.name} | ${entry.version ?? ''} | ${entry.license} |`),
      '',
      noticeOnly.length === 0
        ? ''
        : `> Notice-required licenses in use: ${[...new Set(noticeOnly.map(entry => entry.license))].join(', ')}. Their license texts ship inside node_modules; see the package LICENSE files for the full terms.`,
      '',
    ].filter(line => line !== '')
    writeFileSync(join(packageRoot, target), lines.join('\n'))
  }

  const total = seen.size - 1
  const summary = noticeOnly.length === 0
    ? `verify-licenses: ${total} production packages carry redistribution-safe licenses`
    : `verify-licenses: ${total} production packages checked; ${noticeOnly.length} use notice-required licenses (${[...new Set(noticeOnly.map(entry => entry.license))].join(', ')})`
  process.stdout.write(`${summary}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
