#!/usr/bin/env node
/**
 * verify-skill-hygiene.mjs — 内置 Skill 目录卫生与单一真源门禁 (#234 / #235 / #237)
 *
 * 强制校验结构性不变量：
 * 1. 零上游重名：产品插件 `skills/`、`dsh.manifest.json`（按路径归一化解析）与 `catalog/skills/` 均不得复制 DSH 上游内核/Creator 模式自带技能；
 * 2. 插件声明闭环：插件 `dsh.manifest.json` 声明与磁盘 `skills/` 目录双向一致（无悬空声明、无未声明目录、无跨插件重名）；
 * 3. 零符号链接：递归扫描 `plugins/plugins/<p>/skills/**` 与 `catalog/skills/**`（含根目录自身），严禁任何深度出现符号链接；
 * 4. 市场目录闭环与去重：`catalog/skills/` 存在且非空，每个目录包含常规非空 `SKILL.md`，且被 `catalog/index.json`（本地 bundled 技能）或 `catalog/bundled-skills.json` 唯一认领（无孤儿、无重叠、无悬空、无重复 `item.skill`、无错误 `source.path`、无逐字节重复正文）；
 * 5. 零空壳与禁静态 `installed: true`（#235）：首页快捷方式、`presets/<p>/skills.json`、`catalog/preset-skills.json` 与内置专家引用的每一个技能 slug 必须解析到真实非空 `SKILL.md`，且静态货架 JSON 不得硬编码 `installed` 字段；
 * 6. 工具引用真源校验（#235）：首页快捷方式与产品插件随包技能引用的具体 OmniMux 工具名必须属于当前工作区实际已注册运行时工具集合；
 * 7. 来源/许可元数据与第三方声明闭环（#237）：`catalog/index.json` 全部条目、`catalog/bundled-skills.json` 与插件 `dsh.manifest.json`（`skillMetadata`）均须携带经校验的 `origin` / `license` / `owner`，禁止不实 `"author": "Official"`、外部热链（`cdn.hailuoai.com`）与第三方厂商契约残留，并与 `THIRD_PARTY_NOTICES.md` 双向一致。
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGINS_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** DSH 上游内核与 Creator 模式原生拥有的技能标识，产品插件与市场目录不得复制重名。 */
export const UPSTREAM_RESERVED_SKILL_SLUGS = new Set([
  'agent-experience',
  'cordis-composition-reference',
  'cordis-plugin-development',
  'editing-cordis-compositions',
  'office',
  'office-docx',
  'office-pptx',
  'office-xlsx',
  'office-export-pdf',
  'office-render',
  'office-recalculate',
  'diagnose-windows-sandbox-acl',
  'dsh-badge',
])

/** 合法的技能/目录条目来源归属枚举（#237）。 */
export const VALID_SKILL_ORIGINS = new Set(['first-party', 'third-party', 'upstream'])

/** 随仓分发（bundled）技能禁止使用的模糊/未定许可字面量。 */
export const FORBIDDEN_BUNDLED_LICENSES = new Set(['UNKNOWN', 'SEE UPSTREAM', 'NONE', 'UNLICENSED', 'TBD'])

const EXTERNAL_HOTLINK_RE = /https?:\/\/cdn\.hailuoai\.com\//i
const THIRD_PARTY_VENDOR_LEFTOVER_RE = /\b(?:kling-generation-runtime|WorkBuddy)\b/

/**
 * @typedef {{ code: string; message: string; path?: string }} SkillHygieneIssue
 */

/** 与工具前缀重合但并非顶层工具名的合法标识（字段名、诊断码、`video_process` 子能力名）。 */
const NON_TOOL_IDENTIFIERS = new Set([
  'video_id',
  'clip_overlap',
  'video_trim',
  'video_merge',
  'video_split',
  'video_thumbnail_extract',
  'video_inline_analysis_prepare',
  'video_scene_detect',
  'video_export',
])

const CONCRETE_TOOL_REF_RE = /\b((?:omnimux|harvest|video|analytics|inspiration|publish|assets|products|workflow|clip|browser|accounts|skillhub|plaza|plugin|connector|tiktok_selection)_[a-z0-9_]+)\b/g

/**
 * 收集工作区全部产品插件实际注册的运行时工具名（纯静态零依赖扫描，支持 CI 无 node_modules 环境）。
 * @param {string} pluginsDir
 * @returns {Set<string>}
 */
export function collectRegisteredRuntimeTools(pluginsDir) {
  const names = new Set()
  if (!existsSync(pluginsDir)) return names

  function scanSource(code) {
    for (const re of [
      /\btool\s*\(\s*['"`]([a-z][a-z0-9_-]+)['"`]/g,
      /\b(?:tools(?:\.|\?\.)register(?:\?\.)?|defineTool)\s*\(\s*\{[\s\S]{0,240}?\bname:\s*['"`]([a-z][a-z0-9_-]+)['"`]/g,
      /\bname:\s*['"`](workflow_[a-z0-9_]+|canvas_[a-z0-9_]+|clip_[a-z0-9_]+|plaza_[a-z0-9_]+|plugin_[a-z0-9_]+|connector_[a-z0-9_]+|skillhub_[a-z0-9_]+)['"`]/g,
      /\bSTT_TOOL_NAME\s*=\s*['"`]([a-z][a-z0-9_]+)['"`]/g,
    ]) {
      for (const m of code.matchAll(re)) names.add(m[1])
    }
    const factories = /\bconst\s+([A-Za-z_]\w*)\s*=\s*\(\s*name\b[^()]*\)\s*(?::\s*\w+)?\s*=>\s*defineTool\s*\(\s*\{\s*name\s*,/g
    for (const [, factory] of code.matchAll(factories)) {
      const calls = new RegExp(`\\b${factory}\\s*\\(\\s*(['"])([\\w-]+)\\1`, 'g')
      for (const [, , toolName] of code.matchAll(calls)) names.add(toolName)
    }
    if (code.includes('omnimux_${kind}_submit')) {
      names.add('omnimux_video_submit')
      names.add('omnimux_image_submit')
      names.add('omnimux_audio_submit')
    }
  }

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'lib', 'tests', '__tests__', 'client'].includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name === 'tools.manifest.json') {
        try {
          const data = readJson(full)
          for (const item of Array.isArray(data?.tools) ? data.tools : []) {
            if (typeof item?.name === 'string') names.add(item.name)
          }
        } catch {
          // ignore malformed manifest; schema tests handle separately
        }
        continue
      }
      if (!/\.(js|mjs|ts)$/.test(entry.name) || /\.(test|spec)\.(js|mjs|ts)$/.test(entry.name)) continue
      scanSource(readFileSync(full, 'utf8'))
    }
  }

  walk(pluginsDir)
  return names
}

function isNonEmptyRegularFile(filePath) {
  try {
    const st = lstatSync(filePath)
    if (st.isSymbolicLink() || !st.isFile()) return false
    return readFileSync(filePath, 'utf8').trim().length > 0
  } catch {
    return false
  }
}

function extractQuickShortcutSlugs(catalogJsText) {
  const slugs = []
  for (const m of catalogJsText.matchAll(/\bskillSlug:\s*['"]([a-z0-9_-]+)['"]/g)) {
    slugs.push(m[1])
  }
  return slugs
}

function extractBuiltinExpertSkillSlugs(expertMarketTsText) {
  const start = expertMarketTsText.indexOf('export const DEFAULT_MARKET_EXPERTS')
  if (start === -1) return []
  const end = expertMarketTsText.indexOf('\n]', start)
  const slice = end === -1 ? expertMarketTsText.slice(start) : expertMarketTsText.slice(start, end + 2)
  const refs = []
  let currentExpert = ''
  for (const line of slice.split(/\r?\n/)) {
    const idMatch = line.match(/\bid:\s*['"]([a-z0-9_-]+)['"]/)
    if (idMatch) currentExpert = idMatch[1]
    const skillsMatch = line.match(/\bskills:\s*\[([^\]]*)\]/)
    if (skillsMatch) {
      for (const sm of skillsMatch[1].matchAll(/['"]([a-z0-9_-]+)['"]/g)) {
        refs.push({ expertId: currentExpert || 'unknown', slug: sm[1] })
      }
    }
  }
  return refs
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function isInside(rootDir, targetPath) {
  const rel = relative(rootDir, targetPath)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * 递归检查目录树（含根目录自身）是否存在符号链接。
 * @param {string} targetPath
 * @param {string} displayPrefix
 * @param {SkillHygieneIssue[]} issues
 * @returns {boolean} 若根目录本身为符号链接则返回 true
 */
function scanSymlinksRecursive(targetPath, displayPrefix, issues) {
  if (!existsSync(targetPath)) {
    try {
      const st = lstatSync(targetPath)
      if (st.isSymbolicLink()) {
        issues.push({
          code: 'symlink-forbidden',
          path: displayPrefix,
          message: `技能目录不允许符号链接: ${displayPrefix}`,
        })
        return true
      }
    } catch {
      return false
    }
    return false
  }

  const rootStat = lstatSync(targetPath)
  if (rootStat.isSymbolicLink()) {
    issues.push({
      code: 'symlink-forbidden',
      path: displayPrefix,
      message: `技能目录不允许符号链接: ${displayPrefix}`,
    })
    return true
  }
  if (!rootStat.isDirectory()) return false

  /** @param {string} dir @param {string} relPrefix */
  function walk(dir, relPrefix) {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.DS_Store') continue
      const full = join(dir, name)
      const rel = `${relPrefix}/${name}`
      const st = lstatSync(full)
      if (st.isSymbolicLink()) {
        issues.push({
          code: 'symlink-forbidden',
          path: rel,
          message: `技能目录树不允许符号链接: ${rel}`,
        })
        continue
      }
      if (st.isDirectory()) {
        walk(full, rel)
      }
    }
  }

  walk(targetPath, displayPrefix)
  return false
}

/**
 * 执行全量 Skill 卫生校验。
 * @param {string} [pluginsWorkspaceRoot] 默认指向 `plugins/` 工作区根
 * @returns {{ ok: boolean; issues: SkillHygieneIssue[]; stats: { indexedCount: number; bundledCount: number; catalogDirCount: number; pluginSkillCount: number } }}
 */
export function verifySkillHygiene(pluginsWorkspaceRoot = PLUGINS_WORKSPACE_ROOT) {
  /** @type {SkillHygieneIssue[]} */
  const issues = []
  const pluginsDir = join(pluginsWorkspaceRoot, 'plugins')

  /** @type {Map<string, string>} slug -> declaring plugin name */
  const pluginSkillOwners = new Map()
  /** @type {Array<{ slug: string; relDir: string; absDir: string; upstream: string; noticeRef: string; sourcePath: string }>} */
  const bundledThirdPartySkills = []
  let manifestMetadataCount = 0
  let catalogItemCount = 0

  // 1. 产品插件：禁止与上游重名、禁止软链、校验 manifest ↔ skills/ 双向一致与跨插件去重
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const pluginName = entry.name
      const pluginRoot = join(pluginsDir, pluginName)
      const skillsDir = join(pluginRoot, 'skills')
      const manifestPath = join(pluginRoot, 'dsh.manifest.json')

      const diskSkillSlugs = new Set()
      if (existsSync(skillsDir) || (() => { try { return lstatSync(skillsDir).isSymbolicLink() } catch { return false } })()) {
        const rootIsSymlink = scanSymlinksRecursive(skillsDir, `plugins/${pluginName}/skills`, issues)
        if (!rootIsSymlink && existsSync(skillsDir) && lstatSync(skillsDir).isDirectory()) {
          for (const skillEntry of readdirSync(skillsDir).sort()) {
            if (skillEntry.startsWith('.')) continue
            const full = join(skillsDir, skillEntry)
            const st = lstatSync(full)
            if (st.isSymbolicLink() || !st.isDirectory()) continue
            diskSkillSlugs.add(skillEntry)
            if (UPSTREAM_RESERVED_SKILL_SLUGS.has(skillEntry)) {
              issues.push({
                code: 'upstream-collision',
                path: `plugins/${pluginName}/skills/${skillEntry}`,
                message: `产品插件 ${pluginName} 不得复制与 DSH 上游重名的技能: ${skillEntry}`,
              })
            }
          }
        }
      }

      const declaredSlugs = new Set()
      if (existsSync(manifestPath)) {
        const manifest = readJson(manifestPath)
        const declared = Array.isArray(manifest.skills) ? manifest.skills : []
        for (const rawRel of declared) {
          const rel = String(rawRel ?? '').trim()
          const normalized = rel.replace(/\\/g, '/')
          const resolved = resolve(pluginRoot, rel)
          if (!normalized.endsWith('/SKILL.md') || !isInside(pluginRoot, resolved)) {
            issues.push({
              code: 'invalid-manifest-skill-path',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `${pluginName}/dsh.manifest.json 声明了非法技能路径: ${rel}`,
            })
            continue
          }
          const slug = basename(dirname(resolved))
          if (UPSTREAM_RESERVED_SKILL_SLUGS.has(slug)) {
            issues.push({
              code: 'upstream-collision',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `${pluginName}/dsh.manifest.json 不得声明与 DSH 上游重名的技能: ${slug} (${rel})`,
            })
          }
          if (declaredSlugs.has(slug)) {
            issues.push({
              code: 'duplicate-manifest-skill',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `${pluginName}/dsh.manifest.json 重复声明了技能: ${slug}`,
            })
          } else {
            declaredSlugs.add(slug)
          }

          let stat = null
          try {
            stat = lstatSync(resolved)
          } catch {
            stat = null
          }
          if (!stat) {
            issues.push({
              code: 'dangling-manifest-skill',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `${pluginName}/dsh.manifest.json 声明的技能文件不存在: ${rel}`,
            })
          } else if (stat.isSymbolicLink()) {
            issues.push({
              code: 'symlink-forbidden',
              path: `plugins/${pluginName}/${normalized}`,
              message: `${pluginName}/dsh.manifest.json 指向符号链接: ${rel}`,
            })
          } else if (!stat.isFile()) {
            issues.push({
              code: 'invalid-skill-md',
              path: `plugins/${pluginName}/${normalized}`,
              message: `${pluginName}/dsh.manifest.json 声明的技能目标不是常规文件: ${rel}`,
            })
          }

          if (pluginSkillOwners.has(slug) && pluginSkillOwners.get(slug) !== pluginName) {
            issues.push({
              code: 'cross-plugin-duplicate-skill',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `技能 ${slug} 被多个产品插件重复声明: ${pluginSkillOwners.get(slug)} 与 ${pluginName}`,
            })
          } else {
            pluginSkillOwners.set(slug, pluginName)
          }
        }

        for (const slug of diskSkillSlugs) {
          if (!declaredSlugs.has(slug)) {
            issues.push({
              code: 'undeclared-plugin-skill',
              path: `plugins/${pluginName}/skills/${slug}`,
              message: `插件 ${pluginName} 的 skills/${slug} 未在 dsh.manifest.json 中声明`,
            })
          }
        }

        // 1b. 插件随包技能来源/许可/责任方元数据校验（#237）
        if (declaredSlugs.size > 0) {
          const pkgPath = join(pluginRoot, 'package.json')
          const pkgLicense = existsSync(pkgPath) ? String(readJson(pkgPath)?.license || '').trim() : ''
          const skillMeta = manifest.skillMetadata
          if (!skillMeta || typeof skillMeta !== 'object' || Array.isArray(skillMeta)) {
            issues.push({
              code: 'missing-manifest-skill-metadata',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `${pluginName}/dsh.manifest.json 声明了随包技能但缺少 skillMetadata 来源/许可映射`,
            })
          } else {
            for (const slug of declaredSlugs) {
              const entryMeta = skillMeta[slug]
              if (!entryMeta || typeof entryMeta !== 'object') {
                issues.push({
                  code: 'missing-manifest-skill-provenance',
                  path: `plugins/${pluginName}/dsh.manifest.json`,
                  message: `${pluginName}/dsh.manifest.json 的 skillMetadata 缺少技能 ${slug} 的元数据`,
                })
                continue
              }
              manifestMetadataCount += 1
              const origin = String(entryMeta.origin || '').trim()
              const license = String(entryMeta.license || '').trim()
              const owner = String(entryMeta.owner || '').trim()
              if (!VALID_SKILL_ORIGINS.has(origin)) {
                issues.push({
                  code: 'invalid-manifest-skill-origin',
                  path: `plugins/${pluginName}/dsh.manifest.json`,
                  message: `${pluginName}/dsh.manifest.json 技能 ${slug} 的 origin 非法: ${origin || '(empty)'}`,
                })
              }
              if (!license || FORBIDDEN_BUNDLED_LICENSES.has(license.toUpperCase())) {
                issues.push({
                  code: 'invalid-manifest-skill-license',
                  path: `plugins/${pluginName}/dsh.manifest.json`,
                  message: `${pluginName}/dsh.manifest.json 技能 ${slug} 缺少具体 license: ${license || '(empty)'}`,
                })
              } else if (origin === 'first-party' && pkgLicense && license !== pkgLicense) {
                issues.push({
                  code: 'manifest-skill-license-mismatch',
                  path: `plugins/${pluginName}/dsh.manifest.json`,
                  message: `${pluginName}/dsh.manifest.json 自研技能 ${slug} 的 license (${license}) 与 package.json (${pkgLicense}) 不一致`,
                })
              }
              if (!owner) {
                issues.push({
                  code: 'missing-manifest-skill-owner',
                  path: `plugins/${pluginName}/dsh.manifest.json`,
                  message: `${pluginName}/dsh.manifest.json 技能 ${slug} 缺少 owner 字段`,
                })
              }
              if (origin === 'third-party') {
                bundledThirdPartySkills.push({
                  slug,
                  relDir: `skills/${slug}`,
                  absDir: join(pluginRoot, 'skills', slug),
                  upstream: String(entryMeta.upstream || '').trim(),
                  noticeRef: String(entryMeta.noticeRef || '').trim(),
                  sourcePath: `plugins/${pluginName}/dsh.manifest.json`,
                })
              }
            }
            for (const key of Object.keys(skillMeta)) {
              if (!declaredSlugs.has(key)) {
                issues.push({
                  code: 'stale-manifest-skill-metadata',
                  path: `plugins/${pluginName}/dsh.manifest.json`,
                  message: `${pluginName}/dsh.manifest.json 的 skillMetadata 存在未声明技能键: ${key}`,
                })
              }
            }
          }
        }
      }
    }
  }

  // 2. 市场 catalog/skills/ 闭环、去重、无软链与边界校验
  const marketRoot = join(pluginsDir, 'omnimux-market')
  const catalogIndexPath = join(marketRoot, 'catalog', 'index.json')
  const bundledManifestPath = join(marketRoot, 'catalog', 'bundled-skills.json')
  const catalogSkillsDir = join(marketRoot, 'catalog', 'skills')

  const bundledIndexedSlugs = new Set()
  const allIndexedSkillSlugs = new Set()
  if (existsSync(catalogIndexPath)) {
    const indexDoc = readJson(catalogIndexPath)
    const items = Array.isArray(indexDoc?.items) ? indexDoc.items : []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      catalogItemCount += 1
      const itemId = String(item.id || '(no-id)')

      // 2a. catalog/index.json 全量来源/许可/责任方与禁止 Official 归属校验（#237）
      if (String(item.author || '').trim() === 'Official') {
        issues.push({
          code: 'official-author-forbidden',
          path: 'plugins/omnimux-market/catalog/index.json',
          message: `catalog/index.json 条目 ${itemId} 禁止使用不实归属 "author": "Official"`,
        })
      }
      const origin = String(item.origin || '').trim()
      const license = String(item.license || '').trim()
      const owner = String(item.owner || '').trim()
      if (!VALID_SKILL_ORIGINS.has(origin)) {
        issues.push({
          code: 'invalid-catalog-origin',
          path: 'plugins/omnimux-market/catalog/index.json',
          message: `catalog/index.json 条目 ${itemId} 缺少合法 origin (first-party|third-party|upstream): ${origin || '(empty)'}`,
        })
      }
      if (!license) {
        issues.push({
          code: 'missing-catalog-license',
          path: 'plugins/omnimux-market/catalog/index.json',
          message: `catalog/index.json 条目 ${itemId} 缺少 license 字段`,
        })
      }
      if (!owner) {
        issues.push({
          code: 'missing-catalog-owner',
          path: 'plugins/omnimux-market/catalog/index.json',
          message: `catalog/index.json 条目 ${itemId} 缺少 owner 字段`,
        })
      }

      const sourceType = item.source && typeof item.source === 'object' ? item.source.type : undefined
      const isBundledItem = sourceType === 'bundled' || (item.tab === 'skills' && item.kind === 'skill' && sourceType === undefined)
      if (isBundledItem && license && FORBIDDEN_BUNDLED_LICENSES.has(license.toUpperCase())) {
        issues.push({
          code: 'non-concrete-bundled-license',
          path: 'plugins/omnimux-market/catalog/index.json',
          message: `catalog/index.json 随包条目 ${itemId} 必须声明具体 license，不得为 ${license}`,
        })
      }

      if (item.tab !== 'skills' || item.kind !== 'skill') continue
      const slug = typeof item.skill === 'string' ? item.skill.trim() : ''
      if (!slug) continue
      if (allIndexedSkillSlugs.has(slug)) {
        issues.push({
          code: 'duplicate-indexed-skill',
          path: 'plugins/omnimux-market/catalog/index.json',
          message: `catalog/index.json 重复登记了技能 slug: ${slug}`,
        })
        continue
      }
      allIndexedSkillSlugs.add(slug)

      const isBundled = sourceType === undefined || sourceType === 'bundled'
      if (isBundled) {
        bundledIndexedSlugs.add(slug)
        if (origin === 'third-party') {
          bundledThirdPartySkills.push({
            slug,
            relDir: `catalog/skills/${slug}`,
            absDir: join(catalogSkillsDir, slug),
            upstream: String(item.upstream || '').trim(),
            noticeRef: String(item.noticeRef || '').trim(),
            sourcePath: 'plugins/omnimux-market/catalog/index.json',
          })
        }
        if (item.source && typeof item.source === 'object' && typeof item.source.path === 'string') {
          const normalizedPath = item.source.path.replace(/\\/g, '/').replace(/\/+$/, '')
          const expectedDir = `catalog/skills/${slug}`
          const expectedFile = `${expectedDir}/SKILL.md`
          if (normalizedPath !== expectedDir && normalizedPath !== expectedFile) {
            issues.push({
              code: 'invalid-indexed-source-path',
              path: 'plugins/omnimux-market/catalog/index.json',
              message: `catalog/index.json 技能 ${slug} 的 source.path (${item.source.path}) 与目录 ${expectedDir} 不一致`,
            })
          }
        }
      }
    }
  } else {
    issues.push({
      code: 'missing-catalog-index',
      path: 'plugins/omnimux-market/catalog/index.json',
      message: '缺少市场目录真源 catalog/index.json',
    })
  }

  const bundledSlugs = new Set()
  if (existsSync(bundledManifestPath)) {
    const bundledDoc = readJson(bundledManifestPath)
    const entries = Array.isArray(bundledDoc?.skills) ? bundledDoc.skills : []
    for (const item of entries) {
      const slug = String(item?.slug || '').trim()
      if (!slug) {
        issues.push({
          code: 'invalid-bundled-entry',
          path: 'plugins/omnimux-market/catalog/bundled-skills.json',
          message: 'bundled-skills.json 存在缺少 slug 的无效条目',
        })
        continue
      }
      if (bundledSlugs.has(slug)) {
        issues.push({
          code: 'duplicate-bundled-entry',
          path: 'plugins/omnimux-market/catalog/bundled-skills.json',
          message: `bundled-skills.json 重复登记了技能: ${slug}`,
        })
        continue
      }
      bundledSlugs.add(slug)
      if (allIndexedSkillSlugs.has(slug)) {
        issues.push({
          code: 'overlap-bundled-and-indexed',
          path: 'plugins/omnimux-market/catalog/bundled-skills.json',
          message: `技能 ${slug} 同时出现在 index.json 与 bundled-skills.json 中（必须唯一归属）`,
        })
      }
      // 2b. bundled-skills.json 来源/许可/责任方校验（#237）
      const origin = String(item?.origin || '').trim()
      const license = String(item?.license || '').trim()
      const owner = String(item?.owner || '').trim()
      if (!VALID_SKILL_ORIGINS.has(origin)) {
        issues.push({
          code: 'invalid-bundled-origin',
          path: 'plugins/omnimux-market/catalog/bundled-skills.json',
          message: `bundled-skills.json 条目 ${slug} 缺少合法 origin: ${origin || '(empty)'}`,
        })
      }
      if (!license || FORBIDDEN_BUNDLED_LICENSES.has(license.toUpperCase())) {
        issues.push({
          code: 'invalid-bundled-license',
          path: 'plugins/omnimux-market/catalog/bundled-skills.json',
          message: `bundled-skills.json 条目 ${slug} 缺少具体 license: ${license || '(empty)'}`,
        })
      }
      if (!owner) {
        issues.push({
          code: 'missing-bundled-owner',
          path: 'plugins/omnimux-market/catalog/bundled-skills.json',
          message: `bundled-skills.json 条目 ${slug} 缺少 owner 字段`,
        })
      }
      if (origin === 'third-party') {
        bundledThirdPartySkills.push({
          slug,
          relDir: `catalog/skills/${slug}`,
          absDir: join(catalogSkillsDir, slug),
          upstream: String(item?.upstream || '').trim(),
          noticeRef: String(item?.noticeRef || '').trim(),
          sourcePath: 'plugins/omnimux-market/catalog/bundled-skills.json',
        })
      }
    }
  } else {
    issues.push({
      code: 'missing-bundled-manifest',
      path: 'plugins/omnimux-market/catalog/bundled-skills.json',
      message: '缺少随包技能归属清单 catalog/bundled-skills.json',
    })
  }

  const realDirs = new Set()
  /** @type {Map<string, string>} */
  const contentHashes = new Map()

  const catalogSkillsExists = (() => {
    try {
      lstatSync(catalogSkillsDir)
      return true
    } catch {
      return false
    }
  })()

  if (!catalogSkillsExists) {
    issues.push({
      code: 'missing-catalog-skills-dir',
      path: 'plugins/omnimux-market/catalog/skills',
      message: '缺少市场技能目录 plugins/omnimux-market/catalog/skills',
    })
  } else {
    const rootIsSymlink = scanSymlinksRecursive(catalogSkillsDir, 'plugins/omnimux-market/catalog/skills', issues)
    if (!rootIsSymlink && lstatSync(catalogSkillsDir).isDirectory()) {
      for (const name of readdirSync(catalogSkillsDir).sort()) {
        if (name.startsWith('.')) continue
        const full = join(catalogSkillsDir, name)
        const st = lstatSync(full)
        if (st.isSymbolicLink() || !st.isDirectory()) continue
        realDirs.add(name)

        if (UPSTREAM_RESERVED_SKILL_SLUGS.has(name)) {
          issues.push({
            code: 'upstream-collision',
            path: `plugins/omnimux-market/catalog/skills/${name}`,
            message: `catalog/skills 不得包含与 DSH 上游重名的技能: ${name}`,
          })
        }

        if (!bundledIndexedSlugs.has(name) && !bundledSlugs.has(name)) {
          issues.push({
            code: 'unclaimed-catalog-dir',
            path: `plugins/omnimux-market/catalog/skills/${name}`,
            message: `catalog/skills/${name} 未被 catalog/index.json 或 catalog/bundled-skills.json 认领（孤儿目录）`,
          })
        }

        const mdPath = join(full, 'SKILL.md')
        let mdStat = null
        try {
          mdStat = lstatSync(mdPath)
        } catch {
          mdStat = null
        }
        if (!mdStat) {
          issues.push({
            code: 'missing-skill-md',
            path: `plugins/omnimux-market/catalog/skills/${name}`,
            message: `catalog/skills/${name} 缺少 SKILL.md`,
          })
          continue
        }
        if (mdStat.isSymbolicLink()) {
          // 递归扫描已记录 symlink-forbidden，这里跳过读取避免跟随软链
          continue
        }
        if (!mdStat.isFile()) {
          issues.push({
            code: 'invalid-skill-md',
            path: `plugins/omnimux-market/catalog/skills/${name}/SKILL.md`,
            message: `catalog/skills/${name}/SKILL.md 必须是常规文件而非目录或特殊文件`,
          })
          continue
        }
        const raw = readFileSync(mdPath)
        const mdText = raw.toString('utf8')
        if (mdText.trim().length === 0) {
          issues.push({
            code: 'empty-skill-md',
            path: `plugins/omnimux-market/catalog/skills/${name}/SKILL.md`,
            message: `catalog/skills/${name}/SKILL.md 为空文件`,
          })
          continue
        }
        if (EXTERNAL_HOTLINK_RE.test(mdText)) {
          issues.push({
            code: 'external-hotlink-forbidden',
            path: `plugins/omnimux-market/catalog/skills/${name}/SKILL.md`,
            message: `catalog/skills/${name}/SKILL.md 包含禁止的外部媒体热链 (cdn.hailuoai.com)`,
          })
        }
        if (THIRD_PARTY_VENDOR_LEFTOVER_RE.test(mdText)) {
          issues.push({
            code: 'third-party-vendor-leftover',
            path: `plugins/omnimux-market/catalog/skills/${name}/SKILL.md`,
            message: `catalog/skills/${name}/SKILL.md 包含外部厂商契约/品牌残留`,
          })
        }
        const metaYamlPath = join(full, 'meta.yaml')
        if (existsSync(metaYamlPath) && !lstatSync(metaYamlPath).isSymbolicLink()) {
          const metaText = readFileSync(metaYamlPath, 'utf8')
          if (EXTERNAL_HOTLINK_RE.test(metaText)) {
            issues.push({
              code: 'external-hotlink-forbidden',
              path: `plugins/omnimux-market/catalog/skills/${name}/meta.yaml`,
              message: `catalog/skills/${name}/meta.yaml 包含禁止的外部媒体热链 (cdn.hailuoai.com)`,
            })
          }
          if (/^source:\s*official\s*$/m.test(metaText)) {
            issues.push({
              code: 'legacy-official-source-forbidden',
              path: `plugins/omnimux-market/catalog/skills/${name}/meta.yaml`,
              message: `catalog/skills/${name}/meta.yaml 不得使用旧版模糊归属 source: official`,
            })
          }
          if (THIRD_PARTY_VENDOR_LEFTOVER_RE.test(metaText)) {
            issues.push({
              code: 'third-party-vendor-leftover',
              path: `plugins/omnimux-market/catalog/skills/${name}/meta.yaml`,
              message: `catalog/skills/${name}/meta.yaml 包含外部厂商契约/品牌残留`,
            })
          }
        }
        const digest = sha256(raw)
        if (contentHashes.has(digest)) {
          issues.push({
            code: 'duplicate-skill-content',
            path: `plugins/omnimux-market/catalog/skills/${name}/SKILL.md`,
            message: `catalog/skills/${name}/SKILL.md 与 ${contentHashes.get(digest)} 逐字节重复`,
          })
        } else {
          contentHashes.set(digest, name)
        }
      }

      if (realDirs.size === 0) {
        issues.push({
          code: 'empty-catalog-skills-dir',
          path: 'plugins/omnimux-market/catalog/skills',
          message: 'catalog/skills 目录下未发现任何有效技能目录（空扫描域保护）',
        })
      }
    }
  }

  for (const slug of bundledSlugs) {
    if (!realDirs.has(slug)) {
      issues.push({
        code: 'dangling-bundled-entry',
        path: 'plugins/omnimux-market/catalog/bundled-skills.json',
        message: `bundled-skills.json 登记了不存在的目录: ${slug}`,
      })
    }
  }

  for (const slug of bundledIndexedSlugs) {
    if (!realDirs.has(slug)) {
      issues.push({
        code: 'dangling-indexed-entry',
        path: 'plugins/omnimux-market/catalog/index.json',
        message: `catalog/index.json 登记了缺少本地目录的 bundled 技能: ${slug}`,
      })
    }
  }

  // 3. 收集全工作区真实非空 SKILL.md 真源（catalog/skills、产品插件 skills/、catalog/experts/*/skills）
  /** @type {Map<string, string>} */
  const validLocalSkills = new Map()
  for (const name of realDirs) {
    const mdPath = join(catalogSkillsDir, name, 'SKILL.md')
    if (isNonEmptyRegularFile(mdPath)) validLocalSkills.set(name, mdPath)
  }
  /** @type {Array<{ slug: string; filePath: string; relPath: string }>} */
  const pluginSkillDocs = []
  for (const [slug, owner] of pluginSkillOwners.entries()) {
    const mdPath = join(pluginsDir, owner, 'skills', slug, 'SKILL.md')
    if (isNonEmptyRegularFile(mdPath)) {
      validLocalSkills.set(slug, mdPath)
      pluginSkillDocs.push({ slug, filePath: mdPath, relPath: `plugins/${owner}/skills/${slug}/SKILL.md` })
    }
  }
  const catalogExpertsDir = join(marketRoot, 'catalog', 'experts')
  if (existsSync(catalogExpertsDir) && lstatSync(catalogExpertsDir).isDirectory()) {
    for (const expertName of readdirSync(catalogExpertsDir).sort()) {
      if (expertName.startsWith('.')) continue
      const expertDir = join(catalogExpertsDir, expertName)
      if (!lstatSync(expertDir).isDirectory()) continue
      const nestedSkillsDir = join(expertDir, 'skills')
      if (existsSync(nestedSkillsDir) && lstatSync(nestedSkillsDir).isDirectory()) {
        for (const nestedSlug of readdirSync(nestedSkillsDir).sort()) {
          if (nestedSlug.startsWith('.')) continue
          const mdPath = join(nestedSkillsDir, nestedSlug, 'SKILL.md')
          if (isNonEmptyRegularFile(mdPath)) validLocalSkills.set(nestedSlug, mdPath)
        }
      }
    }
  }

  // 4. 零空壳与禁止静态 installed: true 校验（#235）
  let quickShortcutCount = 0
  let presetSkillRefCount = 0
  let builtinExpertSkillRefCount = 0
  /** @type {Set<string>} */
  const quickShortcutSlugs = new Set()

  // 4a. 首页快捷方式（composer-quick-shortcuts/catalog.js）
  const quickShortcutsPath = join(pluginsDir, 'omnimux', 'src', 'client', 'composer-quick-shortcuts', 'catalog.js')
  if (existsSync(quickShortcutsPath)) {
    const slugs = extractQuickShortcutSlugs(readFileSync(quickShortcutsPath, 'utf8'))
    quickShortcutCount = slugs.length
    if (slugs.length === 0) {
      issues.push({
        code: 'empty-quick-shortcuts',
        path: 'plugins/omnimux/src/client/composer-quick-shortcuts/catalog.js',
        message: 'composer-quick-shortcuts/catalog.js 未解析到任何 skillSlug（防门禁空转）',
      })
    }
    for (const slug of slugs) {
      quickShortcutSlugs.add(slug)
      if (!validLocalSkills.has(slug)) {
        issues.push({
          code: 'hollow-quick-shortcut-skill',
          path: 'plugins/omnimux/src/client/composer-quick-shortcuts/catalog.js',
          message: `首页快捷方式引用了缺少真实 SKILL.md 的空壳技能: ${slug}`,
        })
      }
    }
  }

  // 4b. presets/*/skills.json
  const presetsRoot = join(pluginsWorkspaceRoot, 'presets')
  if (existsSync(presetsRoot) && lstatSync(presetsRoot).isDirectory()) {
    for (const entry of readdirSync(presetsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillsJsonPath = join(presetsRoot, entry.name, 'skills.json')
      if (!existsSync(skillsJsonPath)) continue
      const rel = `presets/${entry.name}/skills.json`
      const doc = readJson(skillsJsonPath)
      const list = Array.isArray(doc) ? doc : (Array.isArray(doc?.skills) ? doc.skills : [])
      for (const item of list) {
        const slug = String(item?.slug || item?.skill || '').trim()
        presetSkillRefCount += 1
        if (item && Object.prototype.hasOwnProperty.call(item, 'installed')) {
          issues.push({
            code: 'static-installed-forbidden',
            path: rel,
            message: `${rel} 中的技能 ${slug || '(unknown)'} 不得硬编码静态 installed 字段`,
          })
        }
        if (!slug || !validLocalSkills.has(slug)) {
          issues.push({
            code: 'hollow-preset-skill',
            path: rel,
            message: `${rel} 引用了缺少真实 SKILL.md 的空壳技能: ${slug || '(empty)'}`,
          })
        }
      }
    }
  }

  // 4c. catalog/preset-skills.json
  const presetSkillsPath = join(marketRoot, 'catalog', 'preset-skills.json')
  if (existsSync(presetSkillsPath)) {
    const rel = 'plugins/omnimux-market/catalog/preset-skills.json'
    const mapDoc = readJson(presetSkillsPath)
    for (const [presetId, presetEntry] of Object.entries(mapDoc || {})) {
      const list = Array.isArray(presetEntry?.skills) ? presetEntry.skills : []
      for (const item of list) {
        const slug = String(item?.slug || item?.skill || '').trim()
        presetSkillRefCount += 1
        if (item && Object.prototype.hasOwnProperty.call(item, 'installed')) {
          issues.push({
            code: 'static-installed-forbidden',
            path: rel,
            message: `${rel}[${presetId}] 中的技能 ${slug || '(unknown)'} 不得硬编码静态 installed 字段`,
          })
        }
        if (!slug || !validLocalSkills.has(slug)) {
          issues.push({
            code: 'hollow-preset-shelf-skill',
            path: rel,
            message: `${rel}[${presetId}] 引用了缺少真实 SKILL.md 的空壳技能: ${slug || '(empty)'}`,
          })
        }
      }
    }
  }

  // 4d. 内置专家技能引用（expert-market.ts DEFAULT_MARKET_EXPERTS + catalog/experts/*/.codebuddy-plugin/plugin.json）
  const expertMarketPath = join(marketRoot, 'src', 'expert-market.ts')
  if (existsSync(expertMarketPath)) {
    const expertRefs = extractBuiltinExpertSkillSlugs(readFileSync(expertMarketPath, 'utf8'))
    for (const { expertId, slug } of expertRefs) {
      builtinExpertSkillRefCount += 1
      if (!validLocalSkills.has(slug)) {
        issues.push({
          code: 'hollow-builtin-expert-skill',
          path: 'plugins/omnimux-market/src/expert-market.ts',
          message: `内置专家 ${expertId} 引用了缺少真实 SKILL.md 的空壳技能: ${slug}`,
        })
      }
    }
  }
  if (existsSync(catalogExpertsDir) && lstatSync(catalogExpertsDir).isDirectory()) {
    for (const expertName of readdirSync(catalogExpertsDir).sort()) {
      if (expertName.startsWith('.')) continue
      const expertDir = join(catalogExpertsDir, expertName)
      const pluginJsonPath = join(expertDir, '.codebuddy-plugin', 'plugin.json')
      if (!existsSync(pluginJsonPath)) continue
      const pluginDoc = readJson(pluginJsonPath)
      const declared = Array.isArray(pluginDoc?.skills) ? pluginDoc.skills : []
      for (const relSkill of declared) {
        builtinExpertSkillRefCount += 1
        const resolved = resolve(expertDir, String(relSkill || ''))
        const candidateMd = resolved.endsWith('SKILL.md') ? resolved : join(resolved, 'SKILL.md')
        if (!isInside(expertDir, candidateMd) || !isNonEmptyRegularFile(candidateMd)) {
          issues.push({
            code: 'hollow-bundled-expert-skill',
            path: `plugins/omnimux-market/catalog/experts/${expertName}/.codebuddy-plugin/plugin.json`,
            message: `随包专家 ${expertName} 引用了缺失或非法的技能: ${relSkill}`,
          })
        }
      }
    }
  }

  // 5. 快捷方式与产品插件技能的工具引用真源校验（#235）
  const registeredTools = collectRegisteredRuntimeTools(pluginsDir)
  let toolCheckedSkillCount = 0
  if (registeredTools.size > 0) {
    /** @type {Map<string, string>} */
    const toolScanTargets = new Map()
    for (const slug of quickShortcutSlugs) {
      const filePath = validLocalSkills.get(slug)
      if (filePath) toolScanTargets.set(filePath, relative(pluginsWorkspaceRoot, filePath).replace(/\\/g, '/'))
    }
    for (const doc of pluginSkillDocs) {
      toolScanTargets.set(doc.filePath, doc.relPath)
    }

    for (const [filePath, relPath] of toolScanTargets.entries()) {
      toolCheckedSkillCount += 1
      const text = readFileSync(filePath, 'utf8')
      const seenUnknown = new Set()
      for (const m of text.matchAll(CONCRETE_TOOL_REF_RE)) {
        const toolName = m[1]
        if (toolName.endsWith('_') && text.charAt(m.index + toolName.length) === '*') continue
        if (NON_TOOL_IDENTIFIERS.has(toolName)) continue
        if (!registeredTools.has(toolName) && !seenUnknown.has(toolName)) {
          seenUnknown.add(toolName)
          issues.push({
            code: 'unregistered-skill-tool-reference',
            path: relPath,
            message: `${relPath} 引用了未注册的运行时工具: ${toolName}`,
          })
        }
      }
    }
  }

  // 6. 随仓第三方技能与 THIRD_PARTY_NOTICES.md 双向审校闭环（#237）
  const noticesPath = join(marketRoot, 'THIRD_PARTY_NOTICES.md')
  const noticesExists = existsSync(noticesPath)
  const noticesText = noticesExists ? readFileSync(noticesPath, 'utf8') : ''
  const bundledThirdPartyRelDirs = new Set(bundledThirdPartySkills.map((s) => s.relDir))

  for (const tp of bundledThirdPartySkills) {
    if (!tp.upstream) {
      issues.push({
        code: 'missing-third-party-upstream',
        path: tp.sourcePath,
        message: `随仓第三方技能 ${tp.slug} 缺少 upstream 来源 URL`,
      })
    }
    if (!tp.noticeRef) {
      issues.push({
        code: 'missing-third-party-notice-ref',
        path: tp.sourcePath,
        message: `随仓第三方技能 ${tp.slug} 缺少 noticeRef 声明引用`,
      })
    }
    if (!existsSync(join(tp.absDir, 'LICENSE'))) {
      issues.push({
        code: 'missing-third-party-license-file',
        path: `plugins/omnimux-market/${tp.relDir}`,
        message: `随仓第三方技能 ${tp.slug} 目录内缺少 LICENSE 许可原文`,
      })
    }
    if (!noticesExists || !noticesText.includes(tp.relDir)) {
      issues.push({
        code: 'undocumented-third-party-skill',
        path: 'plugins/omnimux-market/THIRD_PARTY_NOTICES.md',
        message: `随仓第三方技能 ${tp.slug} (${tp.relDir}) 未在 THIRD_PARTY_NOTICES.md 中登记`,
      })
    }
  }

  if (noticesExists) {
    const citedPaths = new Set()
    for (const m of noticesText.matchAll(/(?<![A-Za-z0-9_/-])((?:catalog\/skills|skills)\/[a-z0-9][a-z0-9-]*)(?=\/|[\s`),.;]|$)/g)) {
      citedPaths.add(m[1])
    }
    for (const cited of citedPaths) {
      if (!bundledThirdPartyRelDirs.has(cited)) {
        issues.push({
          code: 'stale-third-party-notice',
          path: 'plugins/omnimux-market/THIRD_PARTY_NOTICES.md',
          message: `THIRD_PARTY_NOTICES.md 引用了并非当前随仓第三方技能的路径: ${cited}`,
        })
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      indexedCount: bundledIndexedSlugs.size,
      bundledCount: bundledSlugs.size,
      catalogDirCount: realDirs.size,
      catalogItemCount,
      pluginSkillCount: pluginSkillOwners.size,
      manifestMetadataCount,
      bundledThirdPartyCount: bundledThirdPartySkills.length,
      quickShortcutCount,
      presetSkillRefCount,
      builtinExpertSkillRefCount,
      registeredToolCount: registeredTools.size,
      toolCheckedSkillCount,
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = verifySkillHygiene()
  if (!result.ok) {
    console.error(`❌ verify-skill-hygiene 失败（${result.issues.length} 项违规）：`)
    for (const issue of result.issues) {
      console.error(`  - [${issue.code}] ${issue.message}`)
    }
    process.exit(1)
  }
  console.log(
    `✅ verify-skill-hygiene 通过：`
    + `catalog/skills 共 ${result.stats.catalogDirCount} 个目录`
    + `（市场已上架 ${result.stats.indexedCount} + 随包登记 ${result.stats.bundledCount}），`
    + `目录全量元数据校验 ${result.stats.catalogItemCount} 条，`
    + `插件随包声明 ${result.stats.pluginSkillCount} 个（skillMetadata ${result.stats.manifestMetadataCount} 条），`
    + `随仓第三方技能 ${result.stats.bundledThirdPartyCount} 个与 THIRD_PARTY_NOTICES.md 对齐，`
    + `快捷方式 ${result.stats.quickShortcutCount} 条、预设/货架引用 ${result.stats.presetSkillRefCount} 条、内置专家引用 ${result.stats.builtinExpertSkillRefCount} 条，`
    + `工具真源校验 ${result.stats.toolCheckedSkillCount} 份技能（已注册工具 ${result.stats.registeredToolCount} 个），`
    + `零上游重名、零符号链接、零孤儿、零空壳、零静态 installed、零未注册工具引用、零不实 Official 归属。`,
  )
}
