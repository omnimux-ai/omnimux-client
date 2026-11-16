#!/usr/bin/env node
/**
 * desktop-patch-audit.mjs — audit the local desktop patches registered in
 * docs/desktop-patches.md against the current source tree and dsh pin.
 *
 * Status model:
 *   PASS             — registered patch file + marker/selector present, verified_against matches dsh-version.
 *   MISSING          — registered file or marker/selector is gone (upstream upgrade wiped it).
 *   ORPHAN           — a `desktop-patch:DP-xxx` marker exists in source but is not registered.
 *   UPSTREAM_FIXED   — registry says the upstream fixed it; the local patch must be deleted.
 *   REVIEW_REQUIRED  — verified_against differs from the current dsh-version commit.
 *
 * Usage:
 *   node scripts/desktop-patch-audit.mjs [--json]
 *
 * Exit code 0 only when every patch is PASS and no orphan marker exists.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsPath = join(repoRoot, 'docs', 'desktop-patches.md')
const versionPath = join(repoRoot, 'dsh-version.json')

const SOURCE_ROOTS = [
  join(repoRoot, 'plugins', 'plugins', 'omnimux', 'src'),
  join(repoRoot, 'app', 'dsh-desktop-next', 'src'),
]
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'vendor', '.git', '.worktrees'])

function fail(message) {
  console.error(`desktop-patch-audit: ${message}`)
  process.exit(1)
}

function readUtf8(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    fail(`无法读取 ${relative(repoRoot, path)}: ${error.message}`)
  }
}

function parseTable(markdown) {
  const lines = markdown.split('\n')
  const headerIndex = lines.findIndex(line => /^\|\s*ID\s*\|/.test(line))
  if (headerIndex === -1) fail('docs/desktop-patches.md 缺少登记表（未找到 | ID | 表头）')
  const headers = splitRow(lines[headerIndex])
  const required = ['ID', '状态', '问题', '位置', '标记/选择器', '影响状态', '上游是否已修复', 'verified_against', '回归方式', '删除条件']
  for (const column of required) {
    if (!headers.includes(column)) fail(`docs/desktop-patches.md 登记表缺少列: ${column}`)
  }
  const rows = []
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith('|')) break
    const cells = splitRow(line)
    if (cells.length !== headers.length) fail(`docs/desktop-patches.md 第 ${index + 1} 行列数不一致`)
    const row = Object.fromEntries(headers.map((header, cell) => [header, cells[cell]]))
    if (!/^DP-\d{3}$/.test(row.ID)) fail(`非法补丁 ID: ${row.ID}`)
    rows.push(row)
  }
  if (rows.length === 0) fail('docs/desktop-patches.md 登记表为空')
  return rows
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim().replace(/`/g, ''))
}

function* walk(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(join(directory, entry.name))
    } else if (/\.(?:js|mjs|ts|tsx|jsx)$/.test(entry.name)) {
      yield join(directory, entry.name)
    }
  }
}

function collectMarkers() {
  const markers = []
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(root)) {
      const text = readFileSync(file, 'utf8')
      const matches = text.matchAll(/desktop-patch:(DP-\d{3})/g)
      for (const match of matches) markers.push({ id: match[1], file: relative(repoRoot, file) })
    }
  }
  return markers
}

function stripLocationSuffix(value) {
  return value.replace(/:\d+(?:-\d+)?$/, '').trim()
}

function checkEntry(row, dshCommit) {
  const findings = []
  const file = stripLocationSuffix(row.位置)
  const fullPath = join(repoRoot, file)
  const upstream = row.上游是否已修复.trim()
  const verified = row.verified_against.trim()

  if (upstream === '是' || upstream.toLowerCase() === 'fixed' || upstream.toLowerCase() === 'yes') {
    findings.push({ status: 'UPSTREAM_FIXED', detail: `上游已修复：删除本地补丁 ${file} 并移除登记行` })
  }
  if (verified !== dshCommit) {
    findings.push({ status: 'REVIEW_REQUIRED', detail: `verified_against=${verified || '(空)'}，当前 dsh=${dshCommit}` })
  }
  if (!existsSync(fullPath)) {
    findings.push({ status: 'MISSING', detail: `文件不存在: ${file}` })
    return findings
  }
  const source = readFileSync(fullPath, 'utf8')
  const tokens = row['标记/选择器'].split('；').map(token => token.trim()).filter(Boolean)
  if (tokens.length === 0) findings.push({ status: 'MISSING', detail: '登记表未提供标记/选择器' })
  for (const token of tokens) {
    const separator = token.indexOf(':')
    if (separator === -1) {
      findings.push({ status: 'MISSING', detail: `非法标记/选择器 token: ${token}` })
      continue
    }
    const kind = token.slice(0, separator)
    const value = token.slice(separator + 1).trim()
    if (!['marker', 'text'].includes(kind)) {
      findings.push({ status: 'MISSING', detail: `未知 token 类型: ${kind}` })
      continue
    }
    if (!source.includes(value)) {
      findings.push({ status: 'MISSING', detail: `${kind} 未在 ${file} 找到: ${value}` })
    }
  }
  return findings
}

const markdown = readUtf8(docsPath)
const version = JSON.parse(readUtf8(versionPath))
const dshCommit = version?.dsh?.commit
if (!dshCommit) fail('dsh-version.json 缺少 dsh.commit')
const rows = parseTable(markdown)
const registryIds = new Set(rows.map(row => row.ID))
const markers = collectMarkers()

const results = []
const counts = { PASS: 0, MISSING: 0, ORPHAN: 0, UPSTREAM_FIXED: 0, REVIEW_REQUIRED: 0 }
for (const row of rows) {
  const findings = checkEntry(row, dshCommit)
  if (findings.length === 0) {
    results.push({ id: row.ID, status: 'PASS', detail: `${row.位置} vs ${dshCommit.slice(0, 12)}` })
    counts.PASS += 1
  } else {
    for (const finding of findings) {
      results.push({ id: row.ID, status: finding.status, detail: finding.detail })
      counts[finding.status] += 1
    }
  }
}
for (const marker of markers) {
  if (!registryIds.has(marker.id)) {
    results.push({ id: marker.id, status: 'ORPHAN', detail: `源码标记未登记: ${marker.file}` })
    counts.ORPHAN += 1
  }
}

const json = process.argv.includes('--json')
if (json) {
  console.log(JSON.stringify({ dshCommit, counts, results }, null, 2))
} else {
  for (const result of results) {
    console.log(`[${result.status}] ${result.id} — ${result.detail}`)
  }
  const bad = counts.MISSING + counts.ORPHAN + counts.UPSTREAM_FIXED + counts.REVIEW_REQUIRED
  console.log(
    `desktop-patch-audit: ${bad === 0 ? 'OK' : 'FAIL'} — ${counts.PASS} pass, ${counts.MISSING} missing, ` +
    `${counts.ORPHAN} orphan, ${counts.UPSTREAM_FIXED} upstream-fixed, ${counts.REVIEW_REQUIRED} review-required`,
  )
}
process.exit(counts.MISSING + counts.ORPHAN + counts.UPSTREAM_FIXED + counts.REVIEW_REQUIRED === 0 ? 0 : 1)
