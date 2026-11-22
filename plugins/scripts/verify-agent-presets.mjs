#!/usr/bin/env node
/**
 * verify-agent-presets.mjs — 出厂 Agent 预设收敛与健康度硬门禁
 *
 * 核心原则：
 * 1. `plugins/presets/` 物理目录仅允许保留唯一产品默认预设 `omni-agent`（OmniMux 内容电商 Agent）；
 * 2. 创造模式 `cordis` 由 DSH 上游 `@deepseek-ai/dsh-web-app/presets/cordis.patch.yml` 原生提供，严禁在产品目录重复声明；
 * 3. `omni-agent` 必须具备完整的 `Agent.md`、`preset.yml`、`agent.cordis.yml` 与合法非空的 `skills.json`；
 * 4. 严禁出现历史场景预设（`tiktok-agent` 等）或静态子代理目录（`expert-*`）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** `plugins/presets/` 下唯一合法的物理预设目录白名单（cordis 由 DSH 上游提供） */
export const ALLOWED_PRESET_IDS = new Set([
  'omni-agent', // OmniMux 默认内容电商 Agent
])

/**
 * 校验出厂预设目录
 * @param {string} presetsDir
 * @returns {{ valid: boolean; errors: string[]; presets: string[] }}
 */
export function checkPresetsHealth(presetsDir) {
  const errors = []
  if (!existsSync(presetsDir)) {
    return { valid: false, errors: [`预设目录不存在: ${presetsDir}`], presets: [] }
  }

  const entries = readdirSync(presetsDir).filter((name) => {
    if (name.startsWith('.')) return false
    try {
      return statSync(join(presetsDir, name)).isDirectory()
    } catch {
      return false
    }
  }).sort()

  // 1. 检查仅允许 omni-agent 物理预设存在，杜绝历史别名、多预设膨胀与重复 cordis
  for (const pid of entries) {
    if (!ALLOWED_PRESET_IDS.has(pid)) {
      errors.push(`非法预设角色 [${pid}]：产品预设目录已收敛为仅保留唯一默认内容电商 Agent (omni-agent)，cordis 由 DSH 上游提供！`)
    }
  }

  if (!entries.includes('omni-agent')) {
    errors.push('缺少唯一出厂默认预设目录 [omni-agent]！')
  }

  // 2. 校验 omni-agent 核心文件完整性与 skills.json 合法性
  for (const pid of entries) {
    if (!ALLOWED_PRESET_IDS.has(pid)) continue

    for (const requiredFile of ['Agent.md', 'preset.yml', 'agent.cordis.yml']) {
      const targetPath = join(presetsDir, pid, requiredFile)
      if (!existsSync(targetPath)) {
        errors.push(`预设 [${pid}] 缺少必需文件 ${requiredFile}！`)
      } else if (readFileSync(targetPath, 'utf8').trim().length === 0) {
        errors.push(`预设 [${pid}] 的 ${requiredFile} 内容为空！`)
      }
    }

    const skillsJsonPath = join(presetsDir, pid, 'skills.json')
    if (!existsSync(skillsJsonPath)) {
      errors.push(`预设 [${pid}] 缺少 skills.json 技能配置文件！`)
      continue
    }

    try {
      const data = JSON.parse(readFileSync(skillsJsonPath, 'utf8'))
      const list = Array.isArray(data) ? data : (data.skills || [])
      const slugs = new Set(list.map((s) => s.slug || s.skill || s.id).filter(Boolean))
      if (slugs.size === 0) {
        errors.push(`预设 [${pid}] 的 skills.json 中没有配置任何有效技能！`)
      }
    } catch (e) {
      errors.push(`解析预设 [${pid}] 的 skills.json 失败: ${e.message}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    presets: entries,
  }
}

// CLI 执行入口
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetDir = process.argv[2] || join(ROOT, 'presets')
  const res = checkPresetsHealth(targetDir)
  if (!res.valid) {
    console.error(`❌ 出厂 Agent 预设收敛与健康度门禁校验失败：发现 ${res.errors.length} 项违规！`)
    res.errors.forEach((err) => console.error(`   - ${err}`))
    process.exit(1)
  }

  console.log(`✅ 出厂 Agent 预设收敛与健康度校验通过（物理目录仅含 ${res.presets.join(', ')}；cordis 由 DSH 上游提供）。`)
}
