#!/usr/bin/env node
/**
 * scripts/verify-package-files.mjs
 *
 * 插件打包文件白名单 (package.json "files") 完整性门禁：
 * 1. 凡依赖 src/ 作为运行时的插件（main 以 src/ 开头），其 "files" 必须直接包含 "src"，禁止碎片化维护子目录，防静默丢目录事故；
 * 2. 插件的入口 (main, exports["."]) 所指向的文件必须被 "files" 规则包含；
 * 3. 声明了 dsh.bundle 的插件，其 cordis.patch.yml 必须在 "files" 中；
 * 4. 声明了 dsh.client 的插件，其客户端构建产物（如 lib/client.js 或 lib）必须在 "files" 中；
 * 5. 校验 files 中声明的条目，防止书写不存在的死路径。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

function normalizeRelPath(p) {
  let s = p.split(String.fromCharCode(92)).join('/')
  if (s.startsWith('./')) s = s.slice(2)
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

/**
 * 判断指定相对路径 targetPath 是否被 files 白名单规则包含
 * @param {string} targetPath 相对插件根目录的路径（如 "src/index.js" 或 "cordis.patch.yml"）
 * @param {string[]} filesList package.json 的 files 数组
 * @returns {boolean}
 */
export function isPathCoveredByFiles(targetPath, filesList) {
  if (!Array.isArray(filesList) || filesList.length === 0) return true
  const normalizedTarget = normalizeRelPath(targetPath)

  for (const pattern of filesList) {
    const normalizedPattern = normalizeRelPath(pattern)
    // 精确匹配
    if (normalizedTarget === normalizedPattern) return true
    // 祖先目录匹配（例如 files 声明了 "src"，target 是 "src/events/hub.js"）
    if (normalizedTarget.startsWith(normalizedPattern + '/')) return true
  }
  return false
}

/**
 * 校验指定目录下所有插件的 package.json files 配置
 * @param {string} root 项目根目录
 * @returns {{ errors: string[], auditedCount: number, warnings: string[] }}
 */
export function verifyPackageFiles(root = repoRoot) {
  const pluginsDir = resolve(root, 'plugins')
  const errors = []
  const warnings = []
  let auditedCount = 0

  if (!existsSync(pluginsDir)) {
    return { errors: ['plugins directory not found: ' + pluginsDir], auditedCount: 0, warnings }
  }

  const entries = readdirSync(pluginsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)

  for (const pluginName of entries) {
    const pluginDir = join(pluginsDir, pluginName)
    const pkgPath = join(pluginDir, 'package.json')
    if (!existsSync(pkgPath)) continue

    auditedCount++
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (err) {
      errors.push('[' + pluginName + '] package.json 解析失败: ' + err.message)
      continue
    }

    const files = pkg.files
    if (!Array.isArray(files)) {
      warnings.push('[' + pluginName + '] 未显式声明 "files" 字段，默认将打包除忽略外的所有文件')
      continue
    }

    // 检查 1: 声明的 files 条目是否存在于磁盘（排除否定规则如 !lib/tests）
    for (const item of files) {
      if (item.startsWith('!')) continue
      const targetDiskPath = join(pluginDir, item)
      // 如果声明的是构建产物（如 dist/index.js 或 lib/client.js），在未构建时可能不存在，
      // 但如果声明的是源码或配置文件（如 src、cordis.patch.yml、README.md 等），必须存在
      const isBuildArtifact = item.startsWith('dist') || item.startsWith('lib')
      if (!isBuildArtifact && !existsSync(targetDiskPath)) {
        errors.push('[' + pluginName + '] files 中声明的条目 "' + item + '" 在磁盘上不存在')
      }
    }

    // 检查 2: 若插件是以 src 为主源码（main 指向 src/ 或 exports 指向 src/）
    // 核心铁律：禁止细粒度手工罗列 src/foo, src/bar，必须统一声明 "src"
    const mainField = pkg.main || ''
    const isSrcBased = mainField.startsWith('src/') || existsSync(join(pluginDir, 'src/index.js'))
    if (isSrcBased) {
      const hasSrcRoot = files.some(f => f === 'src' || f === 'src/')
      if (!hasSrcRoot) {
        errors.push(
          '[' + pluginName + '] 运行时依赖 src/ 源码，但 files 中未声明 "src"。' +
          '严禁碎片化罗列 src 子目录（历史事故路径：新增目录易被裁撤），请在 files 中统一声明 "src"'
        )
      }
    }

    // 检查 3: 入口文件 (main) 必须被 files 覆盖
    if (mainField) {
      if (!isPathCoveredByFiles(mainField, files)) {
        errors.push('[' + pluginName + '] 主入口 main ("' + mainField + '") 未被 files 白名单规则覆盖，打包后将导致无法加载！')
      }
    }

    // 检查 4: dsh.bundle 声明的 cordis.patch.yml 必须在 files 中
    const bundlePatch = pkg.dsh?.bundle?.patch
    if (bundlePatch || existsSync(join(pluginDir, 'cordis.patch.yml'))) {
      const patchRel = bundlePatch ? normalizeRelPath(bundlePatch) : 'cordis.patch.yml'
      if (!isPathCoveredByFiles(patchRel, files)) {
        errors.push('[' + pluginName + '] 声明了 Cordis 补丁文件 "' + patchRel + '"，但未被 files 白名单包含，打包后插件扩展将无法装载！')
      }
    }

    // 检查 5: 声明了 dsh.client 的客户端插件，若有构建产物 lib/client.js，必须在 files 中
    if (pkg.dsh?.client) {
      const hasClientInFiles = isPathCoveredByFiles('lib/client.js', files) || isPathCoveredByFiles('lib', files)
      if (!hasClientInFiles) {
        errors.push('[' + pluginName + '] 声明了 dsh.client，但 files 未包含客户端打包产物 "lib/client.js"')
      }
    }
  }

  return { errors, auditedCount, warnings }
}

// CLI 执行入口
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  console.log('== 正在执行插件打包清单 (package.json files) 完整性巡检... ==')
  const { errors, auditedCount, warnings } = verifyPackageFiles(repoRoot)

  for (const w of warnings) {
    console.warn('⚠ ' + w)
  }

  if (errors.length > 0) {
    console.error('')
    console.error('❌ 发现 ' + errors.length + ' 项包打包清单违规：')
    for (const err of errors) {
      console.error('  - ' + err)
    }
    console.error('')
    console.error('请参照工程规范：凡使用 src 作为运行时的插件，必须在 package.json 的 files 中声明 "src"，以确保新增模块完整物化。')
    process.exit(1)
  }

  console.log('✓ 全量 ' + auditedCount + ' 个插件的 package.json files 规则全部合规闭环，无漏项。')
}
