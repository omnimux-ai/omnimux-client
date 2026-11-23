#!/usr/bin/env node
/**
 * verify-skill-hygiene.mjs — 内置 Skill 目录卫生与单一真源门禁 (#234)
 *
 * 强制校验结构性不变量：
 * 1. 零上游重名：产品插件 `skills/`、`dsh.manifest.json`（按路径归一化解析）与 `catalog/skills/` 均不得复制 DSH 上游内核/Creator 模式自带技能；
 * 2. 插件声明闭环：插件 `dsh.manifest.json` 声明与磁盘 `skills/` 目录双向一致（无悬空声明、无未声明目录、无跨插件重名）；
 * 3. 零符号链接：递归扫描 `plugins/plugins/<p>/skills/**` 与 `catalog/skills/**`（含根目录自身），严禁任何深度出现符号链接；
 * 4. 市场目录闭环与去重：`catalog/skills/` 存在且非空，每个目录包含常规非空 `SKILL.md`，且被 `catalog/index.json`（本地 bundled 技能）或 `catalog/bundled-skills.json` 唯一认领（无孤儿、无重叠、无悬空、无重复 `item.skill`、无错误 `source.path`、无逐字节重复正文）。
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

/**
 * @typedef {{ code: string; message: string; path?: string }} SkillHygieneIssue
 */

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
      if (!item || item.tab !== 'skills' || item.kind !== 'skill') continue
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

      const sourceType = item.source && typeof item.source === 'object' ? item.source.type : undefined
      const isBundled = sourceType === undefined || sourceType === 'bundled'
      if (isBundled) {
        bundledIndexedSlugs.add(slug)
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
        if (raw.toString('utf8').trim().length === 0) {
          issues.push({
            code: 'empty-skill-md',
            path: `plugins/omnimux-market/catalog/skills/${name}/SKILL.md`,
            message: `catalog/skills/${name}/SKILL.md 为空文件`,
          })
          continue
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

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      indexedCount: bundledIndexedSlugs.size,
      bundledCount: bundledSlugs.size,
      catalogDirCount: realDirs.size,
      pluginSkillCount: pluginSkillOwners.size,
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
    + `插件随包声明 ${result.stats.pluginSkillCount} 个，`
    + `零上游重名、零符号链接、零孤儿、零逐字节重复。`,
  )
}
