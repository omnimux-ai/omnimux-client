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
  'plugins/plugins/*/lib/client.js',
  'plugins/omnimux-workflow/dist',
  'plugins/plugins/omnimux-workflow/dist',
  'plugins/omnimux-workflow/lib/canvas.js',
  'plugins/plugins/omnimux-workflow/lib/canvas.js',
  '.agent-reports',
  'plugins/.agent-reports',
  'docs/evidence/dev-smoke*',
  'plugins/docs/evidence/dev-smoke*',
  ':(glob)**/node-compile-cache/**',
]

export function isForbiddenArtifact(path) {
  const rel = String(path || '').replace(/\\/g, '/')
  if (!rel) return false
  if (/^(?:plugins\/)?plugins\/omnimux-workflow\/dist(?:\/|$)/.test(rel)) {
    return true
  }
  if (/^(?:plugins\/)?plugins\/omnimux-workflow\/lib\/canvas\.js$/.test(rel)) {
    return true
  }
  if (/^(?:plugins\/)?plugins\/[^/]+\/lib\/client\.js$/.test(rel)) {
    return true
  }
  if (/(?:^|\/)\.agent-reports(?:\/|$)/.test(rel)) {
    return true
  }
  if (/(?:^|\/)docs\/evidence\/dev-smoke[^/]*(?:\/|$)/.test(rel)) {
    return true
  }
  if (/(?:^|\/)node-compile-cache(?:\/|$)/.test(rel)) {
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
    '插件客户端生成物、运行期报告（.agent-reports）、冒烟产物（dev-smoke*）与节点编译缓存（node-compile-cache）不得进 Git（源码为唯一真相）。',
    '请 git rm --cached 下列文件，构建产物走 sync-to-app 或 pnpm --filter <pkg> run build 现场生成，运行期证据改写 os.tmpdir() 或 .workbuddy/evidence/：',
    ...paths.map((p) => `  - ${p}`),
  ].join('\n')
}

function cleanGitEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key]
  }
  return env
}

export function gitLsForbiddenArtifacts(root) {
  const env = cleanGitEnv()
  const topRes = spawnSync(
    'git',
    ['-C', root, 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8', env },
  )
  if (topRes.status !== 0) {
    const err = String(topRes.stderr || topRes.stdout || 'git rev-parse --show-toplevel failed').trim()
    throw new Error(err || 'git rev-parse --show-toplevel failed')
  }
  const gitTop = String(topRes.stdout || '').trim() || root
  const res = spawnSync(
    'git',
    [
      '-C',
      gitTop,
      '-c',
      'core.quotepath=false',
      'ls-files',
      '--',
      ...FORBIDDEN_ARTIFACT_GLOBS,
    ],
    { encoding: 'utf8', env },
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
