#!/usr/bin/env node
/**
 * verify-global-skills.mjs — 插件随包技能 Provider 契约与全局上下文预算硬门禁 (#236)
 *
 * 强制校验：
 * 1. 全量原生注册：所有在 `dsh.manifest.json` 声明 `skills` 的产品插件，其非测试 `src/` 源码
 *    必须包含通过 DSH `ctx.skills.registerProvider` 在 `BUNDLED_SKILL_RANK` (600) 注册随包技能
 *    并解析 `disable-model-invocation` 策略的模块；
 * 2. Frontmatter 合法性：每个随包 `SKILL.md` 必须具有合法 YAML frontmatter，严禁出现 DSH
 *    拒绝的旧驼峰键名（`disableModelInvocation` / `modelInvocable` / `userInvocable`），且
 *    `disable-model-invocation` / `user-invocable` 取值必须为合法布尔值；
 * 3. 全局上下文预算与显式白名单：全仓所有插件随包技能中，全局默认 `modelInvocable: true`
 *    的技能总数不得超过预算上限（<= 4），且每个均须位于显式批准的全局核心白名单
 *    （`ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS`）。其余垂类 SOP 与无头 JSON Schema 技能
 *    必须声明 `disable-model-invocation: true`（全局 0-Token，由 `/<slug>`、技能选择器或
 *    专家 Preset 作用域按需激活）。
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGINS_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 全仓插件随包技能允许保持全局 `modelInvocable: true` 的硬上限。 */
export const GLOBAL_MODEL_INVOCABLE_BUDGET = 4

/** 显式批准保持全局 `modelInvocable: true` 的高频核心技能白名单。 */
export const ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS = new Set([
  'clip-craft',          // 全能剪辑脚本协议核心底座
  'omnimux-social-data', // 公开社媒数据层统一路由底座
])

/** DSH `SkillRegistry` 严格拒绝的旧驼峰调用策略键名。 */
export const FORBIDDEN_FRONTMATTER_KEYS = new Set([
  'disableModelInvocation',
  'modelInvocable',
  'userInvocable',
])

/**
 * 解析布尔型 frontmatter 标量。合法值返回 boolean，未设置返回 undefined，非法返回 null。
 * @param {string | undefined} raw
 * @returns {boolean | undefined | null}
 */
export function parseFrontmatterBoolean(raw) {
  if (raw === undefined) return undefined
  const normalized = String(raw).trim().toLowerCase()
  if (normalized === '') return null
  if (['true', 'yes', 'on', '1'].includes(normalized)) return true
  if (['false', 'no', 'off', '0'].includes(normalized)) return false
  return null
}

/**
 * 解析 `SKILL.md` 顶部 YAML frontmatter 的顶层键与值（零外部依赖，兼容 LF/CRLF）。
 * @param {string} raw
 * @returns {{ hasFrontmatter: boolean; keys: string[]; metadata: Record<string, string>; body: string }}
 */
export function parseSkillFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  if (!match) {
    return { hasFrontmatter: false, keys: [], metadata: {}, body: raw.trim() }
  }
  const keys = []
  /** @type {Record<string, string>} */
  const metadata = {}
  for (const line of match[1].split(/\r?\n/)) {
    // 跳过空行、注释行与缩进嵌套行（仅识别顶层键）
    if (!line || /^\s/.test(line) || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    keys.push(key)
    metadata[key] = value
  }
  return { hasFrontmatter: true, keys, metadata, body: match[2].trim() }
}

/**
 * 扫描插件 `src/` 非测试源码，检查是否存在合规的随包技能 Provider 注册模块。
 * 要求同一源码文件同时满足：
 * - 调用 `registerProvider(`；
 * - 声明 `BUNDLED_SKILL_RANK = 600` 或 `rank: 600` / `rank: BUNDLED_SKILL_RANK`；
 * - 读取 `disable-model-invocation` 调用策略；
 * - 绑定 DSH `skills` 服务（`inject(['skills'` / `.skills`）。
 *
 * @param {string} pluginDir
 * @returns {{ ok: boolean; matchedFile?: string; reason?: string }}
 */
export function inspectPluginSkillProvider(pluginDir) {
  const srcDir = join(pluginDir, 'src')
  if (!existsSync(srcDir)) {
    return { ok: false, reason: 'missing src/ directory' }
  }
  /** @type {string[]} */
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'fixtures' || entry.name === 'fixture') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(?:[cm]?js|ts)$/u.test(entry.name)) continue
      if (/\.(?:test|spec)\.(?:[cm]?js|ts)$/u.test(entry.name)) continue
      files.push(full)
    }
  }
  walk(srcDir)

  for (const file of files.sort()) {
    const text = readFileSync(file, 'utf8')
    const hasRegisterProvider = /\bregisterProvider\s*\(/u.test(text)
    const rank600Consts = [...text.matchAll(/\b([A-Z0-9_]*SKILL_RANK)\s*=\s*600\b/gu)].map((m) => m[1])
    const hasRank600 = /\brank\s*:\s*600\b/u.test(text)
      || rank600Consts.some((name) => new RegExp(`\\brank\\s*:\\s*${name}\\b`, 'u').test(text))
    const hasPolicy = /disable-model-invocation/u.test(text)
    const hasSkillsService = /['"]skills['"]|\.\s*skills\b/u.test(text)
    if (hasRegisterProvider && hasRank600 && hasPolicy && hasSkillsService) {
      return { ok: true, matchedFile: relative(pluginDir, file).split(sep).join('/') }
    }
  }
  return {
    ok: false,
    reason: 'no non-test src/ module registers bundled skills via ctx.skills.registerProvider at rank 600 with disable-model-invocation handling',
  }
}

/**
 * 全仓校验插件随包技能 Provider 契约、frontmatter 合法性与全局 `modelInvocable: true` 上下文预算。
 *
 * @param {{
 *   pluginsDir?: string
 *   budget?: number
 *   allowedGlobalSkills?: ReadonlySet<string>
 * }} [options]
 */
export function verifyGlobalSkills(options = {}) {
  const pluginsDir = resolve(options.pluginsDir ?? join(PLUGINS_WORKSPACE_ROOT, 'plugins'))
  const budget = options.budget ?? GLOBAL_MODEL_INVOCABLE_BUDGET
  const allowedGlobalSkills = options.allowedGlobalSkills ?? ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS

  /** @type {{ code: string; message: string; path?: string }[]} */
  const issues = []
  /** @type {string[]} */
  const pluginsChecked = []
  /** @type {{ plugin: string; slug: string; modelInvocable: boolean; userInvocable: boolean; file: string }[]} */
  const skills = []

  if (!existsSync(pluginsDir)) {
    issues.push({
      code: 'missing-plugins-dir',
      message: `plugins directory does not exist: ${pluginsDir}`,
      path: pluginsDir,
    })
    return {
      valid: false,
      issues,
      pluginsChecked,
      totalBundledSkills: 0,
      globalModelInvocable: [],
      zeroTokenSkills: [],
      budget,
    }
  }

  const pluginEntries = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of pluginEntries) {
    const pluginId = entry.name
    const pluginDir = join(pluginsDir, pluginId)
    const manifestPath = join(pluginDir, 'dsh.manifest.json')
    if (!existsSync(manifestPath)) continue

    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      issues.push({
        code: 'invalid-plugin-manifest',
        message: `${pluginId}/dsh.manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        path: manifestPath,
      })
      continue
    }

    const declared = Array.isArray(manifest?.skills) ? manifest.skills : []
    if (declared.length === 0) continue

    pluginsChecked.push(pluginId)

    // 1. 校验宿主源码通过 ctx.skills.registerProvider 在 BUNDLED_SKILL_RANK (600) 注册
    const providerCheck = inspectPluginSkillProvider(pluginDir)
    if (!providerCheck.ok) {
      issues.push({
        code: 'missing-bundled-skill-provider',
        message: `plugin ${pluginId} declares ${declared.length} bundled skill(s) in dsh.manifest.json, but ${providerCheck.reason}`,
        path: manifestPath,
      })
    }

    // 2. 校验每个声明的 SKILL.md frontmatter 与调用策略
    for (const rel of declared) {
      if (typeof rel !== 'string' || !rel.trim()) {
        issues.push({
          code: 'invalid-skill-declaration',
          message: `plugin ${pluginId} has invalid skill entry in dsh.manifest.json: ${JSON.stringify(rel)}`,
          path: manifestPath,
        })
        continue
      }
      const file = resolve(pluginDir, rel)
      const relDisplay = `${pluginId}/${rel}`
      if (!existsSync(file) || !lstatSync(file).isFile()) {
        issues.push({
          code: 'missing-declared-skill',
          message: `declared bundled skill file is missing: ${relDisplay}`,
          path: file,
        })
        continue
      }

      const raw = readFileSync(file, 'utf8')
      const { hasFrontmatter, keys, metadata } = parseSkillFrontmatter(raw)
      if (!hasFrontmatter) {
        issues.push({
          code: 'missing-frontmatter',
          message: `${relDisplay} is missing YAML frontmatter`,
          path: file,
        })
        continue
      }

      for (const key of keys) {
        if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) {
          issues.push({
            code: 'forbidden-frontmatter-key',
            message: `${relDisplay} uses DSH-rejected legacy frontmatter key "${key}" (use kebab-case "disable-model-invocation" / "user-invocable")`,
            path: file,
          })
        }
      }

      const disableModelParsed = parseFrontmatterBoolean(metadata['disable-model-invocation'])
      if (disableModelParsed === null) {
        issues.push({
          code: 'invalid-invocation-boolean',
          message: `${relDisplay} has non-boolean disable-model-invocation value: ${JSON.stringify(metadata['disable-model-invocation'])}`,
          path: file,
        })
      }

      const userInvocableParsed = parseFrontmatterBoolean(metadata['user-invocable'])
      if (userInvocableParsed === null) {
        issues.push({
          code: 'invalid-invocation-boolean',
          message: `${relDisplay} has non-boolean user-invocable value: ${JSON.stringify(metadata['user-invocable'])}`,
          path: file,
        })
      }

      const slug = basename(dirname(file))
      const modelInvocable = disableModelParsed !== true
      const userInvocable = userInvocableParsed !== false

      skills.push({ plugin: pluginId, slug, modelInvocable, userInvocable, file: relDisplay })

      if (modelInvocable && !allowedGlobalSkills.has(slug)) {
        issues.push({
          code: 'unapproved-global-model-invocable',
          message: `${relDisplay} (${slug}) is globally modelInvocable: true but not in ALLOWED_GLOBAL_MODEL_INVOCABLE_SKILLS; add "disable-model-invocation: true" or seek explicit budget approval`,
          path: file,
        })
      }
    }
  }

  const globalModelInvocable = skills.filter((s) => s.modelInvocable).map((s) => s.slug).sort()
  const zeroTokenSkills = skills.filter((s) => !s.modelInvocable).map((s) => s.slug).sort()

  if (globalModelInvocable.length > budget) {
    issues.push({
      code: 'global-model-invocable-budget-exceeded',
      message: `global modelInvocable bundled skills count (${globalModelInvocable.length}) exceeds budget (${budget}): [${globalModelInvocable.join(', ')}]`,
    })
  }

  return {
    valid: issues.length === 0,
    issues,
    pluginsChecked,
    totalBundledSkills: skills.length,
    globalModelInvocable,
    zeroTokenSkills,
    budget,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const customPluginsDir = process.argv[2]
  const res = verifyGlobalSkills(customPluginsDir ? { pluginsDir: customPluginsDir } : {})
  if (!res.valid) {
    console.error(`❌ verify-global-skills 失败（${res.issues.length} 项违规）：`)
    for (const issue of res.issues) {
      console.error(`   - [${issue.code}] ${issue.message}`)
    }
    process.exit(1)
  }
  console.log(
    `✅ verify-global-skills 通过：${res.pluginsChecked.length} 个插件 / ${res.totalBundledSkills} 个随包技能，`
    + `全局 modelInvocable=${res.globalModelInvocable.length}/${res.budget} [${res.globalModelInvocable.join(', ')}]，`
    + `全局 0-Token 按需技能=${res.zeroTokenSkills.length}。`,
  )
}
