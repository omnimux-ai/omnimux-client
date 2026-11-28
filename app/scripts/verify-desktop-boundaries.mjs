/** Architectural boundary gate: ensure dsh-desktop-next holds zero reverse code/asset paths into dsh-plugin-desktop. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|(?:^|[;\n])\s*import\s+|\bvi\.(?:do)?[Mm]ock\s*\(\s*|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/gu
const CSS_DIRECTIVE = /@(?:import|source)\s+['"]([^'"]+)['"]/gu
const NSIS_INCLUDE = /!include\s+(?:\/\w+\s+)*["']?([^"'\s;\n]+)["']?/gu
const LEGACY_DESKTOP_PATH = /(?:^|\/)dsh-plugin-desktop(?:\/|$)/u
const RELATIVE_LEGACY_PATH = /\.\.\/dsh-plugin-desktop(?:\/|$)/u

function normalizePath(path) {
  return path.replaceAll('\\', '/')
}

function findCodeOrPathViolation(source) {
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = normalizePath(match[1] ?? '')
    if (LEGACY_DESKTOP_PATH.test(specifier)) return specifier
  }
  for (const match of source.matchAll(/['"]([^'"]*dsh-plugin-desktop[^'"]*)['"]/gu)) {
    const literal = normalizePath(match[1] ?? '')
    if (RELATIVE_LEGACY_PATH.test(literal)) return literal
  }
  return undefined
}

function findCssViolation(source) {
  for (const match of source.matchAll(CSS_DIRECTIVE)) {
    const target = normalizePath(match[1] ?? '')
    if (LEGACY_DESKTOP_PATH.test(target)) return target
  }
  return undefined
}

function findNsisViolation(source) {
  for (const match of source.matchAll(NSIS_INCLUDE)) {
    const target = normalizePath(match[1] ?? '')
    if (LEGACY_DESKTOP_PATH.test(target)) return target
  }
  return undefined
}

function findPackageJsonViolation(source) {
  const manifest = JSON.parse(source)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [key, value] of Object.entries(manifest[section] ?? {})) {
      if (LEGACY_DESKTOP_PATH.test(normalizePath(key))) return `${section}.${key}`
      if (typeof value === 'string' && LEGACY_DESKTOP_PATH.test(normalizePath(value))) return `${section}.${key}=${value}`
    }
  }
  const nsisInclude = manifest.build?.nsis?.include
  if (typeof nsisInclude === 'string' && LEGACY_DESKTOP_PATH.test(normalizePath(nsisInclude))) {
    return `build.nsis.include=${nsisInclude}`
  }
  for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
    if (typeof script === 'string' && LEGACY_DESKTOP_PATH.test(normalizePath(script))) {
      return `scripts.${name}`
    }
  }
  return undefined
}

/** Check tracked/in-memory dsh-desktop-next files for reverse path references into dsh-plugin-desktop. */
export function verifyDesktopBoundaries(files) {
  const violations = []
  for (const [rawPath, source] of files) {
    const path = normalizePath(rawPath)
    let hit
    if (path === 'dsh-desktop-next/package.json') hit = findPackageJsonViolation(source)
    else if (path.endsWith('.css')) hit = findCssViolation(source)
    else if (/\.(?:nsh|nsi)$/u.test(path)) hit = findNsisViolation(source)
    else if (/\.[cm]?[jt]sx?$/u.test(path)) hit = findCodeOrPathViolation(source)
    if (hit !== undefined) violations.push(`${path} (${hit})`)
  }
  if (violations.length > 0) {
    throw new Error(`Next desktop shell must not reference dsh-plugin-desktop paths: ${violations.join(', ')}`)
  }
  return { fileCount: files.length }
}

/** Verify all tracked files in app/dsh-desktop-next against reverse legacy shell references. */
export function verifyTrackedDesktopBoundaries(root) {
  const paths = execFileSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', '-z', '--', 'dsh-desktop-next'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(path => path === 'dsh-desktop-next/package.json' || /\.(?:[cm]?[jt]sx?|css|nsh|nsi)$/u.test(path))
    .map(normalizePath)
  return verifyDesktopBoundaries(
    paths.map(path => [path, readFileSync(resolve(root, path), 'utf8')]),
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const result = verifyTrackedDesktopBoundaries(appRoot)
  process.stdout.write(`verify-desktop-boundaries: verified ${String(result.fileCount)} dsh-desktop-next files with zero references to dsh-plugin-desktop\n`)
}
