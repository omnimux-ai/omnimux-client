import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findToolNamesInSource } from './verify-plugin-agent-tools.mjs'

export const DOCS_IMPACT_START = '<!-- omnimux-docs-impact:start -->'
export const DOCS_IMPACT_END = '<!-- omnimux-docs-impact:end -->'

export const SUBSYSTEM_DOCUMENTS = {
  'desktop-file-picker': 'app/docs/architecture.md',
  'plugin-agent-tools': 'plugins/docs/contracts/plugin-agent-tools-inventory.md',
}

const pickerPaths = [
  /^app\/dsh-plugin-desktop\/src\/(?:native-file-picker[^/]*|electron-shell-generation\.ts|preload\.ts)$/,
  /^app\/dsh-desktop-next\/src\/(?:main|preload-app)\.ts$/,
  /^plugins\/packages\/dsh-ui-kit\/src\/native-file-picker[^/]*$/,
  /^(?:app\/docs\/architecture(?:\.en)?\.md|specs\/native-file-picker\.spec\.md)$/,
]
const productSource = /^plugins\/plugins\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/
const tests = /(?:\.(?:test|spec)\.|\/(?:tests|__tests__|test-fixtures)\/)/
const pickerCode = /\b(?:requestFilePicker|hasDesktopFilePicker|nativeFilePicker|openNativeFilePicker|DESKTOP_FILE_PICKER_CHANNEL)\b|\.filePicker\.(?:open|\w+)/
const toolPaths = /\/(?:agent-tools|tools)(?:\/|[.\/-])|^plugins\/plugins\/omnimux-workflow\/src\/workflow\/agent\//
const toolCode = /\b(?:defineTool|AgentToolSpec)\b|\bctx\.tools(?:\?\.|\.)register\b|from\s+['"][^'"]*(?:agent-tools|\/tools(?:\/|\.))/

function sourceAt(cwd, path, version) {
  try {
    if (version) {
      return execFileSync('git', ['show', version + ':' + path], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      })
    }
    return readFileSync(resolve(cwd, path), 'utf8')
  } catch (error) {
    if (version ? error.status === 128 : error.code === 'ENOENT') return ''
    throw error
  }
}

/** Paths include both sides of renames. Inspect base and candidate source so removed APIs still match. */
export function classifyDocsImpact(paths, { cwd, base, head } = {}) {
  const impacted = new Set()
  for (const path of paths) {
    if (pickerPaths.some(pattern => pattern.test(path))) impacted.add('desktop-file-picker')
    if (path === SUBSYSTEM_DOCUMENTS['plugin-agent-tools']) impacted.add('plugin-agent-tools')
    if (!productSource.test(path) || tests.test(path)) continue

    if (toolPaths.test(path)) impacted.add('plugin-agent-tools')
    if (!cwd || impacted.size === Object.keys(SUBSYSTEM_DOCUMENTS).length) continue
    const sources = [sourceAt(cwd, path, head)]
    if (base) sources.push(sourceAt(cwd, path, base))
    if (sources.some(source => pickerCode.test(source))) impacted.add('desktop-file-picker')
    if (!impacted.has('plugin-agent-tools') && sources.some(source => toolCode.test(source) || findToolNamesInSource(source).size > 0)) {
      impacted.add('plugin-agent-tools')
    }
  }
  return Object.keys(SUBSYSTEM_DOCUMENTS).filter(id => impacted.has(id))
}

const fields = ['subsystem', 'document', 'decision', 'behavior', 'evidence']
const plainLine = (value) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= 1000 && !/[\r\n\u0000-\u001f\u007f]/.test(value)

export function validateDocsImpact(rows, requiredIds, changedPaths) {
  if (!Array.isArray(rows)) throw new Error('文档影响记录必须是 JSON 数组')
  const seen = new Set()
  for (const row of rows) {
    const id = row?.subsystem
    if (!row || Object.keys(row).length !== fields.length ||
        !fields.every(field => Object.hasOwn(row, field)) ||
        !Object.hasOwn(SUBSYSTEM_DOCUMENTS, id) || seen.has(id) ||
        row.document !== SUBSYSTEM_DOCUMENTS[id] ||
        !['updated', 'unchanged'].includes(row.decision) ||
        !plainLine(row.behavior) || !plainLine(row.evidence)) {
      throw new Error('文档影响记录的子系统、主文档、决定或依据无效')
    }
    if (row.decision === 'updated' && changedPaths && !changedPaths.includes(row.document)) {
      throw new Error('主文档未出现在实际改动中：' + row.document)
    }
    seen.add(id)
  }
  const missing = requiredIds.filter(id => !seen.has(id))
  if (missing.length > 0) throw new Error('缺少试点子系统文档影响记录：' + missing.join(', '))
  return rows
}

export function readDocsImpact(path, requiredIds, changedPaths) {
  return validateDocsImpact(JSON.parse(readFileSync(path, 'utf8')), requiredIds, changedPaths)
}

function markdownText(value) {
  return value.trim().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function renderDocsImpact(rows) {
  if (!rows.length) return '## 文档影响\n\n本次改动未命中试点子系统。'
  const lines = rows.map(row => {
    const decision = row.decision === 'updated' ? '已更新' : '行为一致'
    return '- **' + row.subsystem + '** · ' + row.document + ' · ' + decision +
      '\n  - 行为与依据：' + markdownText(row.behavior) +
      '\n  - 验证证据：' + markdownText(row.evidence)
  })
  return '## 文档影响\n\n' + lines.join('\n')
}

export function wrapDocsImpact(rows) {
  return [DOCS_IMPACT_START, renderDocsImpact(rows), DOCS_IMPACT_END].join('\n')
}

/** Return the exact managed PR section. Normalize CRLF used by some editors. */
export function readDocsImpactSection(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const start = lines.indexOf(DOCS_IMPACT_START)
  const end = lines.indexOf(DOCS_IMPACT_END)
  if (start === -1 && end === -1) return undefined
  if (start === -1 || end < start || start !== lines.lastIndexOf(DOCS_IMPACT_START) ||
      end !== lines.lastIndexOf(DOCS_IMPACT_END)) {
    throw new Error('PR 文档影响段落的边界标记不完整或重复')
  }
  return lines.slice(start, end + 1).join('\n')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('用法：node plugins/scripts/docs-impact.mjs <文档影响 JSON>')
    console.log(wrapDocsImpact(readDocsImpact(process.argv[2], [])))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
