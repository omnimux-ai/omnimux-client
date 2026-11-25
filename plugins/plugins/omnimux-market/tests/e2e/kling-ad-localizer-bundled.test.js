import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installBundledPack } from '../../src/expert/install.js'

test('kling-global-ad-localizer: catalog entries and bundled files are valid', () => {
  const catalogPath = join(import.meta.dirname, '../../catalog/index.json')
  assert.ok(existsSync(catalogPath), 'catalog/index.json must exist')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

  // 1. 技能条目校验（Phase 4 已重写为纯自研 global-ad-localizer）
  const skillEntry = catalog.items.find((x) => x.id === 'sk-omx-global-ad-localizer')
  assert.ok(skillEntry, 'sk-omx-global-ad-localizer must exist in index.json')
  assert.equal(skillEntry.tab, 'skills')
  assert.equal(skillEntry.kind, 'skill')
  assert.equal(skillEntry.origin, 'first-party')
  assert.equal(skillEntry.license, 'MIT')
  assert.equal(skillEntry.owner, 'omnimux-market')
  assert.equal(skillEntry.author, 'OmniMux')
  assert.equal(skillEntry.source?.type, 'bundled')
  assert.equal(skillEntry.source?.path, 'catalog/skills/global-ad-localizer')
  assert.equal(skillEntry.titleZh, '多语言出海视频广告')
  assert.equal(skillEntry.titleEn, 'Global Ad Localizer')
  assert.ok(skillEntry.summaryZh, 'must have Chinese summary')
  assert.ok(skillEntry.summaryEn, 'must have English summary')

  // 2. 物理文件完整性与零外部契约残留
  const pkgRoot = join(import.meta.dirname, '../..')
  const skillDir = join(pkgRoot, 'catalog/skills/global-ad-localizer')
  assert.ok(existsSync(join(skillDir, 'SKILL.md')), 'SKILL.md must exist')
  assert.ok(existsSync(join(skillDir, 'meta.yaml')), 'meta.yaml must exist')
  assert.ok(existsSync(join(skillDir, 'agents/global-ad-localizer.md')), 'agent md must exist')
  assert.equal(existsSync(join(skillDir, 'references/kling-generation-runtime.md')), false, 'external vendor runtime contract must be removed')
  assert.equal(existsSync(join(skillDir, 'expert.png')), false, 'third-party avatar must be removed')
})

test('kling-global-ad-localizer: bundled install unpacks skill and references', () => {
  const pkgRoot = join(import.meta.dirname, '../..')
  const catalog = JSON.parse(readFileSync(join(pkgRoot, 'catalog/index.json'), 'utf8'))
  const skillEntry = catalog.items.find((x) => x.id === 'sk-omx-global-ad-localizer')
  assert.ok(skillEntry)

  const tempHome = mkdtempSync(join(tmpdir(), 'global-ad-localizer-install-test-'))
  try {
    installBundledPack(tempHome, skillEntry, pkgRoot)

    // 验证释放出的主技能包
    const installedDir = join(tempHome, 'skills', 'global-ad-localizer')
    assert.ok(existsSync(join(installedDir, 'SKILL.md')), 'SKILL.md must exist after install')
    assert.ok(existsSync(join(installedDir, 'agents/global-ad-localizer.md')), 'agent definition preserved')
    const skillContent = readFileSync(join(installedDir, 'SKILL.md'), 'utf8')
    assert.ok(skillContent.includes('出海多语言视频广告本地化'), 'SKILL.md content preserved')
    assert.equal(skillContent.includes('kling-generation-runtime'), false, 'no external runtime leftover')
    assert.equal(skillContent.includes('WorkBuddy'), false, 'no third-party leftover')
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})
