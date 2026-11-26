import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../../../')
const snapshotPath = path.join(ROOT, 'plugins/omnimux/src/client/session-guide/skills/featured-skills.json')
const catalogPath = path.join(ROOT, 'plugins/omnimux-market/catalog/index.json')
const skillsDir = path.join(ROOT, 'plugins/omnimux-market/catalog/skills')

describe('E2E: 112套营销技能库全面去品牌化与专有工具描述彻底脱敏核验', () => {
  it('验证全量快照与目录中零品牌残留，author均为Official且tags无原厂词汇', () => {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

    // 1. 验证快照 skills 数量与 tags
    assert.equal(snapshot.skills.length, 36, '必须有 36 套完整自研上架技能')
    for (const s of snapshot.skills) {
      assert.ok(!s.tags.some(t => t.toLowerCase() === 'creatify'), `技能 ${s.id} 标签不得包含原厂词汇`)
      assert.ok(!s.cover.includes('creatify'), `技能 ${s.id} 封面路径不得泄漏原厂目录`)
    }

    // 2. 验证 catalog items 中的技能（Phase 4：禁用不实 Official 归属，要求结构化 provenance）
    const activeSkills = catalog.items.filter(i => i.kind === 'skill' && i.recommended)
    assert.equal(activeSkills.length, 36, 'catalog 激活技能数必须为 36')
    for (const item of activeSkills) {
      const expectedOwner = item.skill === 'clip-craft' ? 'omnimux-clip' : 'omnimux-market'
      const expectedLicense = item.skill === 'clip-craft' ? 'SEE LICENSE IN LICENSE' : 'MIT'
      assert.equal(item.author, 'OmniMux', `技能 ${item.id} 作者必须为 OmniMux`)
      assert.equal(item.origin, 'first-party', `技能 ${item.id} origin 必须为 first-party`)
      assert.equal(item.license, expectedLicense, `技能 ${item.id} license 必须为 ${expectedLicense}`)
      assert.equal(item.owner, expectedOwner, `技能 ${item.id} owner 必须为 ${expectedOwner}`)
      assert.ok(!item.tags.some(t => t.toLowerCase() === 'creatify'), `技能 ${item.id} 标签不得包含原厂词汇`)
      assert.ok(!item.cover.asset.includes('creatify'), `技能 ${item.id} 封面路径必须脱敏`)
    }

    // 3. 验证自研技能正文零外部品牌/厂商契约残留
    const localizerMd = fs.readFileSync(path.join(skillsDir, 'global-ad-localizer/SKILL.md'), 'utf8')
    assert.ok(!localizerMd.includes('kling-generation-runtime'), 'global-ad-localizer 不得包含外部运行契约')
    assert.ok(!localizerMd.includes('WorkBuddy'), 'global-ad-localizer 不得包含外部品牌残留')

    const ecomMeta = fs.readFileSync(path.join(skillsDir, 'ecommerce-image/meta.yaml'), 'utf8')
    assert.ok(!ecomMeta.includes('cdn.hailuoai.com'), 'ecommerce-image 不得包含外部热链')
  })
})
