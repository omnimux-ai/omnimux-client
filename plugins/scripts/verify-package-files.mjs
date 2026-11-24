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

import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
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

const REQUIRED_DISPLAY_LOCALES = ['en', 'zh']

/**
 * 校验所有插件是否符合 DSH 插件展示元信息（locale/*.json）与国际化规范：
 * 1. locale/en.json 与 locale/zh.json 必须存在且包含非空字符串 meta.title / meta.description；
 * 2. package.json.exports 必须声明 "./locale/*.json" 与 "./package.json"；
 * 3. package.json.files 必须覆盖 locale/en.json 与 locale/zh.json；
 * 4. package.json.description 必须与 locale/en.json 的 meta.description 一致；
 * 5. 标题不得退化为原始包名 slug（omnimux-*），文案不得使用中点 "·" 作为分隔符。
 * @param {string} root 项目根目录
 * @returns {{ errors: string[], auditedCount: number }}
 */
export function verifyPluginDisplayMeta(root = repoRoot) {
  const pluginsDir = resolve(root, 'plugins')
  const errors = []
  let auditedCount = 0

  if (!existsSync(pluginsDir)) {
    return { errors: ['plugins directory not found: ' + pluginsDir], auditedCount: 0 }
  }

  const entries = readdirSync(pluginsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort()

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

    const exportsField = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : null
    if (!exportsField || exportsField['./locale/*.json'] !== './locale/*.json') {
      errors.push('[' + pluginName + '] package.json.exports 缺少 "./locale/*.json": "./locale/*.json"')
    }
    if (!exportsField || exportsField['./package.json'] !== './package.json') {
      errors.push('[' + pluginName + '] package.json.exports 缺少 "./package.json": "./package.json"')
    }

    const pkgRequire = typeof pkg.name === 'string' && pkg.name.trim() !== ''
      ? createRequire(pkgPath)
      : null
    if (pkgRequire && exportsField && exportsField['./package.json'] === './package.json') {
      try {
        const resolvedPkg = pkgRequire.resolve(pkg.name + '/package.json')
        if (realpathSync(resolvedPkg) !== realpathSync(pkgPath)) {
          errors.push('[' + pluginName + '] Node 自引用导出 "' + pkg.name + '/package.json" 解析路径不匹配')
        }
      } catch (err) {
        errors.push('[' + pluginName + '] Node 自引用导出 "' + pkg.name + '/package.json" 无法解析: ' + err.message)
      }
    }

    const hasFilesField = Array.isArray(pkg.files)
    const isLocaleCovered = (rel) => {
      if (!hasFilesField) return true
      if (pkg.files.length === 0) return false
      const normalizedTarget = normalizeRelPath(rel)
      const negated = pkg.files.some(p => {
        if (typeof p !== 'string' || !p.startsWith('!')) return false
        const neg = normalizeRelPath(p.slice(1))
        return neg === normalizedTarget || normalizedTarget.startsWith(neg + '/')
      })
      if (negated) return false
      if (isPathCoveredByFiles(rel, pkg.files)) return true
      return pkg.files.some(p =>
        typeof p === 'string' && !p.startsWith('!') &&
        normalizeRelPath(p) === 'locale/*.json' &&
        /^locale\/[^/]+\.json$/u.test(normalizedTarget)
      )
    }
    const parsedLocales = {}

    for (const lang of REQUIRED_DISPLAY_LOCALES) {
      const rel = 'locale/' + lang + '.json'
      const abs = join(pluginDir, rel)
      if (!existsSync(abs)) {
        errors.push('[' + pluginName + '] 缺少多语言元信息文件 "' + rel + '"')
        continue
      }
      if (!isLocaleCovered(rel)) {
        errors.push('[' + pluginName + '] "' + rel + '" 未被 package.json files 白名单覆盖（请在 files 中声明 "locale"）')
      }
      if (pkgRequire && exportsField && exportsField['./locale/*.json'] === './locale/*.json') {
        try {
          const resolvedLocale = pkgRequire.resolve(pkg.name + '/' + rel)
          if (realpathSync(resolvedLocale) !== realpathSync(abs)) {
            errors.push('[' + pluginName + '] Node 自引用导出 "' + pkg.name + '/' + rel + '" 解析路径不匹配')
          }
        } catch (err) {
          errors.push('[' + pluginName + '] Node 自引用导出 "' + pkg.name + '/' + rel + '" 无法解析: ' + err.message)
        }
      }
      let doc
      try {
        doc = JSON.parse(readFileSync(abs, 'utf8'))
      } catch (err) {
        errors.push('[' + pluginName + '] "' + rel + '" JSON 解析失败: ' + err.message)
        continue
      }
      const meta = doc?.meta
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        errors.push('[' + pluginName + '] "' + rel + '" 缺少 meta 对象')
        continue
      }
      for (const field of ['title', 'description']) {
        const val = meta[field]
        if (typeof val !== 'string' || val.trim() === '') {
          errors.push('[' + pluginName + '] "' + rel + '" 缺少非空字符串 meta.' + field)
          continue
        }
        if (val !== val.trim()) {
          errors.push('[' + pluginName + '] "' + rel + '" meta.' + field + ' 包含首尾空白')
        }
        if (/[\r\n]/u.test(val)) {
          errors.push('[' + pluginName + '] "' + rel + '" meta.' + field + ' 不得包含换行符')
        }
        if (val.includes('·')) {
          errors.push('[' + pluginName + '] "' + rel + '" meta.' + field + ' 禁止使用中点 "·" 分隔符')
        }
      }
      if (typeof meta.title === 'string') {
        const trimmedTitle = meta.title.trim()
        if (
          trimmedTitle === pkg.name ||
          trimmedTitle === pluginName ||
          /^omnimux(?:-[a-z0-9]+)*$/u.test(trimmedTitle)
        ) {
          errors.push('[' + pluginName + '] "' + rel + '" meta.title 不得直接使用包名 slug: ' + meta.title)
        }
      }
      parsedLocales[lang] = meta
    }

    if (parsedLocales.en && typeof parsedLocales.en.description === 'string') {
      if (typeof pkg.description !== 'string' || pkg.description.trim() === '') {
        errors.push('[' + pluginName + '] package.json 缺少 description')
      } else if (pkg.description !== parsedLocales.en.description) {
        errors.push('[' + pluginName + '] package.json.description 与 locale/en.json meta.description 不一致')
      }
    }
  }

  return { errors, auditedCount }
}

// CLI 执行入口
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  console.log('== 正在执行插件打包清单 (package.json files) 与展示元信息 (locale/*.json) 完整性巡检... ==')
  const { errors: fileErrors, auditedCount, warnings } = verifyPackageFiles(repoRoot)
  const { errors: metaErrors } = verifyPluginDisplayMeta(repoRoot)
  const errors = [...fileErrors, ...metaErrors]

  for (const w of warnings) {
    console.warn('⚠ ' + w)
  }

  if (errors.length > 0) {
    console.error('')
    console.error('❌ 发现 ' + errors.length + ' 项插件打包清单/展示元信息违规：')
    for (const err of errors) {
      console.error('  - ' + err)
    }
    console.error('')
    console.error('请参照工程规范：确保 files 覆盖 src/locale 等运行时目录，且所有插件提供合规的 locale/{en,zh}.json 展示元信息。')
    process.exit(1)
  }

  console.log('✓ 全量 ' + auditedCount + ' 个插件的 package.json files 与多语言展示元信息规则全部合规闭环，无漏项。')
}
