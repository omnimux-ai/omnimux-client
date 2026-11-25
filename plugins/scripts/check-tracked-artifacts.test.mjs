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
    assert.equal(isForbiddenArtifact('docs/evidence/dev-smoke_1.json'), true)
    assert.equal(isForbiddenArtifact('docs/evidence/dev-smoke2/a.png'), true)
    assert.equal(isForbiddenArtifact('plugins/docs/evidence/dev-smoke-report.json'), true)
    assert.equal(isForbiddenArtifact('plugins/docs/evidence/dev-smoke-abc/dev-page.png'), true)
    assert.equal(isForbiddenArtifact('plugins/plugins/omnimux/lib/client.js'), true)
    assert.equal(isForbiddenArtifact('plugins/plugins/omnimux-workflow/dist/index.js'), true)
    assert.equal(isForbiddenArtifact('plugins/plugins/omnimux-workflow/lib/canvas.js'), true)
    assert.equal(isForbiddenArtifact('node-compile-cache/v25.8.0-arm64/entry'), true)
    assert.equal(
      isForbiddenArtifact('plugins/scripts/comment-native-e2e-saEWBj/tmp/node-compile-cache/v25.8.0-arm64-392347a2-501/734da683'),
      true,
    )

    // 普通文档与契约文件不得被误伤
    assert.equal(isForbiddenArtifact('docs/contracts/dev-pipeline.md'), false)
    assert.equal(isForbiddenArtifact('docs/evidence/viewer-single-mode-3571/report.json'), false)
    assert.equal(isForbiddenArtifact('plugins/plugins/omnimux/src/index.js'), false)

    // 真实临时单仓 Git 仓库端到端验证：无论传入 <repo> 还是 <repo>/plugins，都检出全仓违规产物
    const tempRepo = mkdtempSync(join(tmpdir(), 'omnimux-tracked-artifacts-'))
    t.after(() => rmSync(tempRepo, { recursive: true, force: true }))
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    execSync(`git -C "${tempRepo}" init -b main`, { encoding: 'utf8', env: gitEnv })
    // 模拟 Linux CI 默认 core.quotepath=true，验证含非 ASCII 文件名仍被准确检出（NB-2）
    execSync(`git -C "${tempRepo}" config core.quotepath true`, { encoding: 'utf8', env: gitEnv })
    for (const relPath of [
      '.agent-reports/leak/e2e.json',
      '.agent-reports/中文报告/证据.json',
      'plugins/.agent-reports/task-1/e2e-evidence.json',
      'docs/evidence/dev-smoke-run1/dev-page.png',
      'docs/evidence/dev-smoke_1.json',
      'docs/evidence/dev-smoke2/a.png',
      'node-compile-cache/v25.8.0/entry',
      'plugins/scripts/comment-native-e2e-saEWBj/tmp/node-compile-cache/v25.8.0-arm64-392347a2-501/734da683',
      'plugins/plugins/omnimux/lib/client.js',
      'plugins/plugins/omnimux-workflow/dist/index.js',
      'plugins/plugins/omnimux-workflow/lib/canvas.js',
      'plugins/plugins/omnimux/src/index.js',
    ]) {
      const full = join(tempRepo, relPath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, 'x\n')
    }
    execSync(`git -C "${tempRepo}" add .`, { encoding: 'utf8', env: gitEnv })

    const expected = [
      '.agent-reports/leak/e2e.json',
      '.agent-reports/中文报告/证据.json',
      'docs/evidence/dev-smoke-run1/dev-page.png',
      'docs/evidence/dev-smoke2/a.png',
      'docs/evidence/dev-smoke_1.json',
      'node-compile-cache/v25.8.0/entry',
      'plugins/.agent-reports/task-1/e2e-evidence.json',
      'plugins/plugins/omnimux-workflow/dist/index.js',
      'plugins/plugins/omnimux-workflow/lib/canvas.js',
      'plugins/plugins/omnimux/lib/client.js',
      'plugins/scripts/comment-native-e2e-saEWBj/tmp/node-compile-cache/v25.8.0-arm64-392347a2-501/734da683',
    ].sort()

    for (const rootArg of [tempRepo, join(tempRepo, 'plugins')]) {
      const result = checkTrackedArtifacts(rootArg)
      assert.equal(result.ok, false)
      assert.deepEqual(result.tracked.sort(), expected)
      assert.match(result.message, /\.agent-reports/)
      assert.match(result.message, /git rm --cached/)
    }
  })
})
