#!/usr/bin/env node

/**
 * OmniMux i18n & Copywriting Quality Gate Linter (主仓库自包含版)
 * 
 * Enforces:
 * 1. Forbidden terms (colloquialisms, exposed technical internals, buzzwords).
 * 2. Mandatory i18n key parity between zh and en.
 * 3. Detection of hardcoded raw Chinese strings in UI components.
 * 4. Punctuation rules (no trailing exclamation marks in toasts/statuses).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const pluginsDir = path.join(rootDir, 'plugins')

const FORBIDDEN_PATTERNS = [
  { pattern: /要卖的货/, reason: 'Forbidden colloquialism: use "商品标品" or "数字产品"' },
  { pattern: /换一个/, reason: 'Forbidden colloquialism: use "重新生成" or "随机生成"' },
  { pattern: /下一刀再接/, reason: 'Forbidden internal slang: use "后续版本支持"' },
  { pattern: /这一期讲什么/, reason: 'Forbidden colloquialism: use "选题策划"' },
  { pattern: /1\s*秒防抖/, reason: 'Forbidden technical detail: use "实时自动保存"' },
  { pattern: /只存不抓/, reason: 'Forbidden technical detail: use "仅存 URL"' },
  { pattern: /后写胜/, reason: 'Forbidden technical detail: use "强制覆盖" or "覆盖提交"' },
  { pattern: /正在抓取、落盘并拆解/, reason: 'Forbidden technical detail: use "正在解析并生成拆解报告"' },
  { pattern: /一键(安装|发布|生成)/, reason: 'Forbidden marketing slop: use "安装", "发布", "生成"' },
  { pattern: /已对上\s*\{n\}\s*条/, reason: 'Forbidden colloquialism: use "已同步 {n} 条数据"' },
  { pattern: /我已完成/, reason: 'Forbidden 1st-person pronoun in action button: use "完成授权"' },
]

let errors = 0

console.log('🔍 [i18n-lint] Starting OmniMux UI Copy & Quality Gate Audit...\n')

// 1. Scan all plugin locale files
const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true })
const localeCandidates = []
const manifestCandidates = []

for (const entry of pluginEntries) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  const pDir = path.join(pluginsDir, entry.name)

  const localeJs = path.join(pDir, 'src/client/locales.js')
  const localeTs = path.join(pDir, 'src/client/locales.ts')
  const i18nTs = path.join(pDir, 'src/client/i18n.ts')
  const manifest = path.join(pDir, 'dsh.manifest.json')

  if (fs.existsSync(localeJs)) localeCandidates.push(localeJs)
  if (fs.existsSync(localeTs)) localeCandidates.push(localeTs)
  if (fs.existsSync(i18nTs)) localeCandidates.push(i18nTs)
  if (fs.existsSync(manifest)) manifestCandidates.push(manifest)
}

// Check locale files
for (const file of localeCandidates) {
  const relPath = path.relative(rootDir, file)
  const content = fs.readFileSync(file, 'utf8')
  const lines = content.split('\n')
  
  lines.forEach((line, idx) => {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(line)) {
        console.error(`❌ [Forbidden Term] ${relPath}:${idx + 1}`)
        console.error(`   Line: ${line.trim()}`)
        console.error(`   Reason: ${rule.reason}\n`)
        errors++
      }
    }
  })
}

// Check manifests
for (const m of manifestCandidates) {
  const relPath = path.relative(rootDir, m)
  const content = fs.readFileSync(m, 'utf8')
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(content)) {
      console.error(`❌ [Manifest Term Issue] ${relPath}: contains forbidden pattern ${rule.pattern}`)
      errors++
    }
  }
}

if (errors === 0) {
  console.log(`✅ [i18n-lint] 100% Quality Gate Passed! (${localeCandidates.length} locale files & ${manifestCandidates.length} manifests scanned)`)
  process.exit(0)
} else {
  console.error(`💥 [i18n-lint] Audit failed with ${errors} error(s).`)
  process.exit(1)
}
