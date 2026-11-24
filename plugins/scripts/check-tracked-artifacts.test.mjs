import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkTrackedArtifacts,
  checkTrackedWorkflowArtifacts,
  forbiddenTrackedPaths,
  formatFailure,
  isForbiddenArtifact,
  isForbiddenWorkflowArtifact,
} from './check-tracked-artifacts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

describe('check-tracked-artifacts：全仓插件客户端生成物与 workflow 生成物不入库', () => {
  it('识别全仓各插件 lib/client.js、workflow dist 与 canvas.js，放过源码', () => {
    assert.equal(isForbiddenArtifact('plugins/omnimux-workflow/dist/index.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-workflow/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-workflow/lib/canvas.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-accounts/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-assets/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-clip/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-inspiration/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-market/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-products/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-publish/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/omnimux-video-preview/lib/client.js'), true)
    
    // 放过源码与普通文件
    assert.equal(isForbiddenArtifact('plugins/omnimux-workflow/src/index.ts'), false)
    assert.equal(isForbiddenArtifact('plugins/omnimux-accounts/src/client/index.js'), false)
    assert.equal(isForbiddenArtifact('plugins/omnimux-market/src/client.js'), false)
    assert.equal(isForbiddenArtifact(''), false)
  })

  it('从 git ls-files 输出抽出违规路径', () => {
    const tracked = forbiddenTrackedPaths([
      'plugins/omnimux-workflow/dist/index.js',
      'plugins/omnimux-workflow/src/index.ts',
      'plugins/omnimux-workflow/lib/canvas.js',
      'plugins/omnimux-accounts/lib/client.js',
      'plugins/omnimux-publish/src/index.js',
    ].join('\n'))
    assert.deepEqual(tracked, [
      'plugins/omnimux-workflow/dist/index.js',
      'plugins/omnimux-workflow/lib/canvas.js',
      'plugins/omnimux-accounts/lib/client.js',
    ])
    assert.equal(forbiddenTrackedPaths('').length, 0)
  })

  it('失败文案要求 git rm --cached 并现场 build', () => {
    const text = formatFailure(['plugins/omnimux-accounts/lib/client.js'])
    assert.match(text, /源码为唯一真相/)
    assert.match(text, /git rm --cached/)
    assert.match(text, /sync-to-app/)
    assert.match(text, /plugins\/omnimux-accounts\/lib\/client\.js/)
  })

  it('当前工作区 git ls-files 不得跟踪任何插件的 client.js 或 workflow 生成物', () => {
    const result = checkTrackedArtifacts(repoRoot)
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(result.tracked, [])
  })

  it('CLI 在本仓退出 0', () => {
    const out = execSync(`node "${join(here, 'check-tracked-artifacts.mjs')}" --root "${repoRoot}"`, {
      encoding: 'utf8',
    })
    assert.match(out, /未跟踪/)
  })

  it('拦截已跟踪的 .agent-reports 与 docs/evidence/dev-smoke* 运行期产物，同时放行普通文档', (t) => {
    assert.equal(isForbiddenArtifact('.agent-reports/gallery-rail-height-2101/e2e-evidence.json'), true)
    assert.equal(isForbiddenArtifact('plugins/.agent-reports/gallery-rail-height-2101/e2e-evidence.json'), true)
    assert.equal(isForbiddenArtifact('docs/evidence/dev-smoke-report.json'), true)
    assert.equal(isForbiddenArtifact('docs/evidence/dev-smoke-761bb9e2/dev-page.png'), true)
    assert.equal(isForbiddenArtifact('plugins/docs/evidence/dev-smoke-report.json'), true)
    assert.equal(isForbiddenArtifact('plugins/docs/evidence/dev-smoke-abc/dev-page.png'), true)

    // 普通文档与契约文件不得被误伤
    assert.equal(isForbiddenArtifact('docs/contracts/dev-pipeline.md'), false)
    assert.equal(isForbiddenArtifact('docs/evidence/viewer-single-mode-3571/report.json'), false)

    // 真实临时 Git 仓库端到端验证 checkTrackedArtifacts 检出已跟踪运行期报告
    const tempRepo = mkdtempSync(join(tmpdir(), 'omnimux-tracked-artifacts-'))
    t.after(() => rmSync(tempRepo, { recursive: true, force: true }))
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    execSync(`git -C "${tempRepo}" init -b main`, { encoding: 'utf8', env: gitEnv })
    mkdirSync(join(tempRepo, 'plugins/.agent-reports/task-1'), { recursive: true })
    mkdirSync(join(tempRepo, 'docs/evidence/dev-smoke-run1'), { recursive: true })
    writeFileSync(join(tempRepo, 'plugins/.agent-reports/task-1/e2e-evidence.json'), '{}\n')
    writeFileSync(join(tempRepo, 'docs/evidence/dev-smoke-run1/dev-page.png'), 'png')
    execSync(`git -C "${tempRepo}" add .`, { encoding: 'utf8', env: gitEnv })

    const result = checkTrackedArtifacts(tempRepo)
    assert.equal(result.ok, false)
    assert.deepEqual(result.tracked.sort(), [
      'docs/evidence/dev-smoke-run1/dev-page.png',
      'plugins/.agent-reports/task-1/e2e-evidence.json',
    ])
    assert.match(result.message, /\.agent-reports/)
    assert.match(result.message, /git rm --cached/)
  })
})
