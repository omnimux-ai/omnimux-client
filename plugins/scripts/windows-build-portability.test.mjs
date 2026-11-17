import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const pluginsRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(pluginsRoot, '..', '..')

const POSIX_ONLY_PATTERNS = [
  { name: 'rm -rf', pattern: /\brm\s+-rf\b/ },
  { name: 'mkdir -p', pattern: /\bmkdir\s+-p\b/ },
  { name: 'cp command', pattern: /(?:^|&&|\|\|)\s*cp\s/ },
  { name: 'mv command', pattern: /(?:^|&&|\|\|)\s*mv\s/ },
  { name: 'POSIX for loop', pattern: /\bfor\s+\w+\s+in\b/ },
  { name: 'POSIX case', pattern: /\bcase\s+["'$]/ },
  { name: 'shell command substitution', pattern: /\$\(/ },
]

function collectPackageDirs() {
  const dirs = []
  const skip = new Set(['node_modules', 'lib', 'dist', '.git'])
  const walk = (directory) => {
    let entries = []
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue
      const child = join(directory, entry.name)
      try {
        readFileSync(join(child, 'package.json'), 'utf8')
        dirs.push(child)
      } catch {}
      walk(child)
    }
  }
  for (const base of ['plugins/plugins', 'plugins/packages']) walk(join(repoRoot, base))
  return dirs.sort()
}

function buildAndPrepareScripts(packageDir) {
  const scripts = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).scripts ?? {}
  return Object.entries(scripts).filter(([name]) => name === 'prepare' || name === 'build' || name.startsWith('build:'))
}

function findPosixOnly(script) {
  return POSIX_ONLY_PATTERNS.filter(({ pattern }) => pattern.test(script)).map(({ name }) => name)
}

describe('Windows cloud build portability', () => {
  it('uses only cross-platform commands in every plugin build/prepare script', () => {
    const violations = []
    for (const packageDir of collectPackageDirs()) {
      const packageName = packageDir.slice(repoRoot.length + 1)
      for (const [scriptName, script] of buildAndPrepareScripts(packageDir)) {
        const hits = findPosixOnly(script)
        if (hits.length > 0) violations.push(`${packageName} ${scriptName}: ${hits.join(', ')}`)
      }
    }
    assert.deepEqual(violations, [])
  })

  it('routes the market build through a Node fs implementation', () => {
    const packageDir = join(repoRoot, 'plugins', 'plugins', 'omnimux-market')
    const scripts = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).scripts
    assert.equal(scripts.build, 'node scripts/build.mjs')
    const source = readFileSync(join(packageDir, 'scripts', 'build.mjs'), 'utf8')
    assert.match(source, /rmSync\(/)
    assert.match(source, /mkdirSync\(/)
    assert.match(source, /copyFileSync\(/)
    assert.match(source, /readdirSync\(/)
    assert.doesNotMatch(source, /rm -rf|mkdir -p|cp src|\bcase\s+["'$]/)
  })

  it('loads Tailwind config through a file URL instead of a bare Windows path', () => {
    const source = readFileSync(join(repoRoot, 'plugins', 'plugins', 'omnimux-clip', 'scripts', 'build-client.mjs'), 'utf8')
    assert.match(source, /pathToFileURL\(join\(root, 'tailwind\.openreel\.config\.js'\)\)\.href/)
    assert.doesNotMatch(source, /await import\(join\(/)
  })

  it('builds the extension PATH with fileURLToPath and the platform delimiter', () => {
    const source = readFileSync(join(repoRoot, 'plugins', 'plugins', 'omnimux-browser', 'extension', 'scripts', 'build.mjs'), 'utf8')
    assert.match(source, /fileURLToPath\(new URL\('\.\.\/node_modules\/\.bin', import\.meta\.url\)\)/)
    assert.match(source, /delimiter/)
    assert.doesNotMatch(source, /new URL\('\.\.\/node_modules\/\.bin', import\.meta\.url\)\.pathname/)
    assert.doesNotMatch(source, /PATH: `\$\{binDir\}:/)
  })

  it('does not spawn a bare npm shim from the build orchestrator', () => {
    const source = readFileSync(join(repoRoot, 'plugins', 'scripts', 'build-all.mjs'), 'utf8')
    assert.doesNotMatch(source, /command:\s*'npm'/)
    assert.match(source, /npm_execpath/)
  })

  it('enables shell resolution for corepack/pnpm in the packaging preflight on Windows', () => {
    const source = readFileSync(join(repoRoot, 'scripts', 'prepare-local-plugins.mjs'), 'utf8')
    assert.match(source, /const windowsShell = process\.platform === 'win32'/)
    assert.match(source, /spawnSync\('corepack', \['--version'\], \{ cwd: repoRoot, encoding: 'utf8', shell: windowsShell \}\)/)
    assert.match(source, /spawnSync\(command, args, \{ cwd: repoRoot, stdio: 'inherit', shell: windowsShell \}\)/)
  })

  it('does not treat the clip Tailwind config input as a generated output', () => {
    const source = readFileSync(join(repoRoot, 'scripts', 'verify-plugin-builds.mjs'), 'utf8')
    assert.match(source, /entry === 'tailwind\.openreel\.config\.js'/)
  })

  it('refreshes the copied browser client mtime for the build freshness check', () => {
    const scripts = JSON.parse(readFileSync(join(repoRoot, 'plugins', 'plugins', 'omnimux-browser', 'package.json'), 'utf8')).scripts
    assert.match(scripts['build:server'], /utimesSync\('lib\/client\.js', now, now\)/)
  })

  it('does not use bare joined paths in any plugin build script dynamic import', () => {
    const violations = []
    for (const packageDir of collectPackageDirs()) {
      let entries = []
      try { entries = readdirSync(join(packageDir, 'scripts'), { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (!entry.isFile() || !/^(?:build|prepare).*\.m?js$/.test(entry.name)) continue
        const source = readFileSync(join(packageDir, 'scripts', entry.name), 'utf8')
        if (/await\s+import\(\s*join\(/.test(source)) violations.push(`${packageDir}/${entry.name}`)
      }
    }
    assert.deepEqual(violations, [])
  })

  it('recognises the POSIX forms that caused the release failure', () => {
    assert.deepEqual(findPosixOnly('rm -rf lib && mkdir -p out && cp a b'), ['rm -rf', 'mkdir -p', 'cp command'])
    assert.deepEqual(findPosixOnly('node scripts/build.mjs'), [])
    assert.deepEqual(findPosixOnly('tsc -b --pretty false && tsdown && node -e "require(\'node:fs\').copyFileSync(\'a\', \'b\')"'), [])
  })
})
