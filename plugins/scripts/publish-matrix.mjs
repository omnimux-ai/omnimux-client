#!/usr/bin/env node
/**
 * scripts/publish-matrix.mjs
 *
 * 把一个 workflow_dispatch 的包选择展开成发布矩阵：
 *  - `packages=all` 取本仓 12 个活跃插件包；也接受逗号分隔的包名或目录；
 *  - 用 `npm view <name>@<version> version` 判断该版本是否已发布；
 *  - dry-run 下未发布包走 `publish-dry-run`，已发布包走 `pack-dry-run`；
 *  - 真实发布下 `all` 跳过已发布版本并给出 warning，显式点名已发布版本直接失败；
 *  - 按包内 dependencies/optionalDependencies/peerDependencies 做拓扑排序，
 *    保证 `omnimux-products` 排在依赖它的 `omnimux-assets` 前面。
 *
 * 输出到 stdout 的 JSON 形如：
 *   { "include": [{ package, dir, version, action }], "warnings": [] }
 * 其中 `include` 直接给 GitHub Actions 的 `matrix.include` 使用。
 *
 * 用法：
 *   node scripts/publish-matrix.mjs [--packages all|a,b] [--dry-run true|false]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

import { classifyPublishState, listPublishablePackages } from './release-check.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')

export const ACTIONS = Object.freeze({
  PUBLISH: 'publish',
  PUBLISH_DRY_RUN: 'publish-dry-run',
  PACK_DRY_RUN: 'pack-dry-run',
})

class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

function parseBoolean(value, flag) {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new UsageError(`${flag} 只接受 true 或 false，收到：${JSON.stringify(value)}`)
}

/**
 * @param {string[]} argv
 * @returns {{ packages: string, dryRun: boolean, help: boolean }}
 */
export function parseArguments(argv = []) {
  let packages = 'all'
  let dryRun = true
  let help = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--packages' || arg === '--dry-run') {
      const next = argv[index + 1]
      if (typeof next !== 'string' || next.startsWith('--')) {
        if (arg === '--dry-run') {
          dryRun = true
          continue
        }
        throw new UsageError(`${arg} 需要一个值`)
      }
      if (arg === '--packages') packages = next
      else dryRun = parseBoolean(next, '--dry-run')
      index += 1
      continue
    }
    if (arg.startsWith('--packages=')) {
      packages = arg.slice('--packages='.length)
      continue
    }
    if (arg.startsWith('--dry-run=')) {
      dryRun = parseBoolean(arg.slice('--dry-run='.length), '--dry-run')
      continue
    }
    throw new UsageError(`未知参数：${arg}`)
  }
  return { packages, dryRun, help }
}

/**
 * 把包名/目录输入解析成本仓的相对目录。只接受本仓活跃包，避免拼错时
 * 静默发布到不存在的目录。
 * @param {string} source
 * @param {string[]} packageDirs
 * @returns {{ isAll: boolean, dirs: string[] }}
 */
export function resolvePackageSelection(source, packageDirs) {
  const raw = String(source ?? '').trim()
  if (!raw) throw new UsageError('packages 不能为空；使用 all 或逗号分隔的包名')
  if (raw.toLowerCase() === 'all') return { isAll: true, dirs: [...packageDirs] }

  const byName = new Map()
  for (const dir of packageDirs) {
    const name = dir.split('/').filter(Boolean).at(-1)
    if (name) byName.set(name, dir)
  }
  const picked = []
  for (const token of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    const normalized = token.replace(/\\/g, '/').replace(/\/+$/, '')
    const name = normalized.split('/').filter(Boolean).at(-1)
    const dir = name ? byName.get(name) : undefined
    if (!dir) {
      throw new UsageError(`未知包：${token}；可用包：${[...byName.keys()].sort().join(', ')}`)
    }
    if (picked.includes(dir)) throw new UsageError(`重复包：${token}`)
    picked.push(dir)
  }
  if (picked.length === 0) throw new UsageError('packages 不能为空；使用 all 或逗号分隔的包名')
  return { isAll: false, dirs: picked }
}

function dependencyNames(manifest) {
  const names = new Set()
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest?.[section]
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
    for (const name of Object.keys(dependencies)) names.add(name)
  }
  return names
}

/**
 * 只在本次选中的包之间排序；未选中的包假定已经发布。
 * 同层按包名排序，保证矩阵输出稳定。
 * @param {Array<{ package: string, dir: string, version: string, action: string }>} entries
 * @param {Map<string, object>} manifests
 * @returns {Array<{ package: string, dir: string, version: string, action: string }>}
 */
export function orderByDependencies(entries, manifests) {
  const byName = new Map(entries.map(entry => [entry.package, entry]))
  const incoming = new Map(entries.map(entry => [entry.package, new Set()]))
  const outgoing = new Map(entries.map(entry => [entry.package, new Set()]))

  for (const entry of entries) {
    for (const dependency of dependencyNames(manifests.get(entry.dir))) {
      if (!byName.has(dependency) || dependency === entry.package) continue
      incoming.get(entry.package).add(dependency)
      outgoing.get(dependency).add(entry.package)
    }
  }

  const ready = [...entries]
    .filter(entry => incoming.get(entry.package).size === 0)
    .sort((a, b) => a.package.localeCompare(b.package))
  const ordered = []
  while (ready.length > 0) {
    const entry = ready.shift()
    ordered.push(entry)
    for (const dependent of [...outgoing.get(entry.package)].sort()) {
      const pending = incoming.get(dependent)
      pending.delete(entry.package)
      if (pending.size === 0) {
        ready.push(byName.get(dependent))
        ready.sort((a, b) => a.package.localeCompare(b.package))
      }
    }
  }
  if (ordered.length !== entries.length) {
    const cycle = entries.filter(entry => !ordered.includes(entry)).map(entry => entry.package).sort()
    throw new Error(`包依赖存在环，无法确定发布顺序：${cycle.join(' -> ')}`)
  }
  return ordered
}

function defaultNpmView({ name, version }) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return {
    status: typeof result.status === 'number' ? result.status : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    errorCode: result.error?.code,
  }
}

function defaultReadManifest(dir) {
  return JSON.parse(readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf8'))
}

/**
 * @param {object} input
 * @param {string} [input.packages]
 * @param {boolean} [input.dryRun]
 * @param {string[]} [input.packageDirs]
 * @param {(dir: string) => object} [input.readManifest]
 * @param {(input: {name: string, version: string}) => object} [input.npmView]
 * @returns {{ include: Array<{ package: string, dir: string, version: string, action: string }>, warnings: string[] }}
 */
export function buildPlan({
  packages = 'all',
  dryRun = true,
  packageDirs = listPublishablePackages(REPO_ROOT),
  readManifest = defaultReadManifest,
  npmView = defaultNpmView,
} = {}) {
  if (typeof dryRun !== 'boolean') throw new UsageError('dryRun 必须是 boolean')
  const selection = resolvePackageSelection(packages, packageDirs)
  const manifests = new Map()
  for (const dir of selection.dirs) {
    const manifest = readManifest(dir)
    if (!manifest || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`${dir}/package.json 缺少可发布的 name/version`)
    }
    manifests.set(dir, manifest)
  }

  const include = []
  const warnings = []
  for (const dir of selection.dirs) {
    const manifest = manifests.get(dir)
    const state = classifyPublishState({
      name: manifest.name,
      version: manifest.version,
      view: npmView({ name: manifest.name, version: manifest.version }),
    })
    if (state.state === 'unknown') {
      throw new Error(`无法确认 ${manifest.name}@${manifest.version} 的发布状态：${state.detail}`)
    }

    let action
    if (dryRun) {
      action = state.state === 'published' ? ACTIONS.PACK_DRY_RUN : ACTIONS.PUBLISH_DRY_RUN
    } else if (state.state === 'published') {
      if (!selection.isAll) {
        throw new Error(`${manifest.name}@${manifest.version} 已在 npm 发布；真实发布必须显式选择下一个版本`)
      }
      warnings.push(`${manifest.name}@${manifest.version} 已发布，真实发布时跳过`)
      continue
    } else {
      action = ACTIONS.PUBLISH
    }
    include.push({ package: manifest.name, dir, version: manifest.version, action })
  }

  if (include.length === 0) {
    throw new Error('没有可发布的包：选中的版本都已在 npm 上发布')
  }
  return { include: orderByDependencies(include, manifests), warnings }
}

function usage() {
  return `用法：node scripts/publish-matrix.mjs [--packages all|a,b] [--dry-run true|false]`
}

/**
 * @param {string[]} argv
 * @param {object} [options]
 * @returns {number}
 */
export function main(argv = process.argv.slice(2), options = {}) {
  let parsed
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    console.error(`publish-matrix: ${error.message}`)
    return 2
  }
  if (parsed.help) {
    console.log(usage())
    return 0
  }
  try {
    const plan = buildPlan({ ...parsed, ...options })
    console.log(JSON.stringify(plan))
    return 0
  } catch (error) {
    console.error(`publish-matrix: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main()
}
