#!/usr/bin/env node
/**
 * verify-skill-hygiene.mjs — 内置 Skill 目录卫生与单一真源门禁 (#234)
 *
 * 强制校验四条结构性不变量：
 * 1. 零上游重名：产品插件 `skills/` 与 `dsh.manifest.json` 不得复制 DSH 上游内核/Creator 模式自带技能；
 * 2. 零符号链接：`plugins/plugins/<p>/skills/` 与 `catalog/skills/` 下严禁符号链接（防止重复目录与 Windows 检出断裂）；
 * 3. 零孤儿/零重叠/零悬空：`catalog/skills/` 下每个目录必须有非空 `SKILL.md`，且被 `catalog/index.json`（skills tab）或 `catalog/bundled-skills.json` 唯一认领；
 * 4. 零逐字节重复：`catalog/skills/` 下不存在两个目录拥有完全一致的 `SKILL.md` 正文哈希。
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGINS_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** DSH 上游内核与 Creator 模式原生拥有的技能标识，产品插件不得复制重名。 */
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

/**
 * 执行全量 Skill 卫生校验。
 * @param {string} [pluginsWorkspaceRoot] 默认指向 `plugins/` 工作区根
 * @returns {{ ok: boolean; issues: SkillHygieneIssue[]; stats: { indexedCount: number; bundledCount: number; catalogDirCount: number } }}
 */
export function verifySkillHygiene(pluginsWorkspaceRoot = PLUGINS_WORKSPACE_ROOT) {
  /** @type {SkillHygieneIssue[]} */
  const issues = []
  const pluginsDir = join(pluginsWorkspaceRoot, 'plugins')

  // 1. 产品插件不得与上游技能重名，且 skills/ 下禁止符号链接
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const pluginName = entry.name
      const pluginRoot = join(pluginsDir, pluginName)
      const skillsDir = join(pluginRoot, 'skills')
      if (existsSync(skillsDir)) {
        for (const skillEntry of readdirSync(skillsDir)) {
          if (skillEntry.startsWith('.')) continue
          const full = join(skillsDir, skillEntry)
          const st = lstatSync(full)
          if (st.isSymbolicLink()) {
            issues.push({
              code: 'symlink-forbidden',
              path: `plugins/${pluginName}/skills/${skillEntry}`,
              message: `插件技能目录不允许符号链接: plugins/${pluginName}/skills/${skillEntry}`,
            })
            continue
          }
          if (!st.isDirectory()) continue
          if (UPSTREAM_RESERVED_SKILL_SLUGS.has(skillEntry)) {
            issues.push({
              code: 'upstream-collision',
              path: `plugins/${pluginName}/skills/${skillEntry}`,
              message: `产品插件 ${pluginName} 不得复制与 DSH 上游重名的技能: ${skillEntry}`,
            })
          }
        }
      }

      const manifestPath = join(pluginRoot, 'dsh.manifest.json')
      if (existsSync(manifestPath)) {
        const manifest = readJson(manifestPath)
        const declared = Array.isArray(manifest.skills) ? manifest.skills : []
        for (const rel of declared) {
          const match = String(rel).match(/^skills\/([^/]+)\/SKILL\.md$/)
          if (match && UPSTREAM_RESERVED_SKILL_SLUGS.has(match[1])) {
            issues.push({
              code: 'upstream-collision',
              path: `plugins/${pluginName}/dsh.manifest.json`,
              message: `${pluginName}/dsh.manifest.json 不得声明与 DSH 上游重名的技能: ${match[1]}`,
            })
          }
        }
      }
    }
  }

  // 2. 市场 catalog/skills/ 闭环、去重、无软链校验
  const marketRoot = join(pluginsDir, 'omnimux-market')
  const catalogIndexPath = join(marketRoot, 'catalog', 'index.json')
  const bundledManifestPath = join(marketRoot, 'catalog', 'bundled-skills.json')
  const catalogSkillsDir = join(marketRoot, 'catalog', 'skills')

  const indexedSlugs = new Set()
  if (existsSync(catalogIndexPath)) {
    const indexDoc = readJson(catalogIndexPath)
    const items = Array.isArray(indexDoc?.items) ? indexDoc.items : []
    for (const item of items) {
      if (item && item.tab === 'skills' && item.kind === 'skill' && typeof item.skill === 'string' && item.skill.trim()) {
        indexedSlugs.add(item.skill.trim())
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
      if (indexedSlugs.has(slug)) {
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

  if (existsSync(catalogSkillsDir)) {
    for (const name of readdirSync(catalogSkillsDir).sort()) {
      if (name.startsWith('.')) continue
      const full = join(catalogSkillsDir, name)
      const st = lstatSync(full)
      if (st.isSymbolicLink()) {
        issues.push({
          code: 'symlink-forbidden',
          path: `plugins/omnimux-market/catalog/skills/${name}`,
          message: `catalog/skills 不允许符号链接: ${name}`,
        })
        continue
      }
      if (!st.isDirectory()) continue
      realDirs.add(name)

      if (!indexedSlugs.has(name) && !bundledSlugs.has(name)) {
        issues.push({
          code: 'unclaimed-catalog-dir',
          path: `plugins/omnimux-market/catalog/skills/${name}`,
          message: `catalog/skills/${name} 未被 catalog/index.json 或 catalog/bundled-skills.json 认领（孤儿目录）`,
        })
      }

      const mdPath = join(full, 'SKILL.md')
      if (!existsSync(mdPath)) {
        issues.push({
          code: 'missing-skill-md',
          path: `plugins/omnimux-market/catalog/skills/${name}`,
          message: `catalog/skills/${name} 缺少 SKILL.md`,
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

  for (const slug of indexedSlugs) {
    if (!realDirs.has(slug)) {
      issues.push({
        code: 'dangling-indexed-entry',
        path: 'plugins/omnimux-market/catalog/index.json',
        message: `catalog/index.json 登记了缺少本地目录的技能: ${slug}`,
      })
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      indexedCount: indexedSlugs.size,
      bundledCount: bundledSlugs.size,
      catalogDirCount: realDirs.size,
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
    + `零上游重名、零符号链接、零孤儿、零逐字节重复。`,
  )
}
