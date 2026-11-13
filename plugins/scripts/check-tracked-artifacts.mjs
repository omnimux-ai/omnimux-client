#!/usr/bin/env node
/**
 * 源码唯一真相：全仓插件的 client/dist/lib 生成物不得进 Git。
 * 安装 / 物化走 prepare 或 sync-to-app 现场 build。
 *
 * Usage:
 *   node scripts/check-tracked-artifacts.mjs
 *   node scripts/check-tracked-artifacts.mjs --root <git-root>
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const FORBIDDEN_ARTIFACT_GLOBS = [
  'plugins/*/lib/client.js',
  'plugins/omnimux-workflow/dist',
  'plugins/omnimux-workflow/lib/canvas.js',
]

export function isForbiddenArtifact(path) {
  const rel = String(path || '').replace(/\\/g, '/')
  if (!rel) return false
  if (rel === 'plugins/omnimux-workflow/dist' || rel.startsWith('plugins/omnimux-workflow/dist/')) {
    return true
  }
  if (rel === 'plugins/omnimux-workflow/lib/canvas.js') {
    return true
  }
  if (/^plugins\/[^/]+\/lib\/client\.js$/.test(rel)) {
    return true
  }
  return false
}

export function isForbiddenWorkflowArtifact(path) {
  return isForbiddenArtifact(path)
}

export function forbiddenTrackedPaths(lsFilesOutput) {
  return String(lsFilesOutput || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isForbiddenArtifact)
}

export function formatFailure(paths) {
  return [
    '插件客户端及分发生成物不得进 Git（源码为唯一真相）。',
    '请 git rm --cached 下列文件，走 sync-to-app 或 pnpm --filter <pkg> run build 现场生成：',
    ...paths.map((p) => `  - ${p}`),
  ].join('\n')
}

export function gitLsForbiddenArtifacts(root) {
  const res = spawnSync(
    'git',
    [
      '-C',
      root,
      'ls-files',
      '--',
      'plugins/*/lib/client.js',
      'plugins/omnimux-workflow/dist',
      'plugins/omnimux-workflow/lib/canvas.js',
    ],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) {
    const err = String(res.stderr || res.stdout || 'git ls-files failed').trim()
    throw new Error(err || 'git ls-files failed')
  }
  return res.stdout
}

export function gitLsWorkflowArtifacts(root) {
  return gitLsForbiddenArtifacts(root)
}

function parseRoot(argv) {
  const idx = argv.indexOf('--root')
  if (idx >= 0 && argv[idx + 1]) return resolve(argv[idx + 1])
  return resolve(here, '..')
}

export function checkTrackedArtifacts(root) {
  const tracked = forbiddenTrackedPaths(gitLsForbiddenArtifacts(root))
  return {
    ok: tracked.length === 0,
    tracked,
    message: tracked.length === 0
      ? 'ok: 全仓插件客户端及 workflow 生成物未跟踪'
      : formatFailure(tracked),
  }
}

export function checkTrackedWorkflowArtifacts(root) {
  return checkTrackedArtifacts(root)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  try {
    const result = checkTrackedArtifacts(parseRoot(process.argv.slice(2)))
    if (!result.ok) {
      console.error(result.message)
      process.exit(1)
    }
    console.log(result.message)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
