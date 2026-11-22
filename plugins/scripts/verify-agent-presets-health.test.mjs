import { test } from 'node:test'
import { equal, ok } from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { checkPresetsHealth } from './verify-agent-presets.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('GATE-02: 出厂预设白名单与正交性校验', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'test-agent-presets-'))
  try {
    // 1. 创建唯一合法的默认内容电商预设 omni-agent
    mkdirSync(join(tmp, 'omni-agent'))
    writeFileSync(join(tmp, 'omni-agent', 'Agent.md'), '# OmniMux Agent\n')
    writeFileSync(join(tmp, 'omni-agent', 'preset.yml'), 'name: OmniMux\norder: 1\n')
    writeFileSync(join(tmp, 'omni-agent', 'agent.cordis.yml'), '- id: persona\n')
    writeFileSync(
      join(tmp, 'omni-agent', 'skills.json'),
      JSON.stringify({
        presetId: 'omni-agent',
        skills: [{ id: 'sk-1', slug: 'replicate-viral-video', installed: true }],
      }),
    )

    const resPass = checkPresetsHealth(tmp)
    equal(resPass.valid, true)
    equal(resPass.errors.length, 0)

    // 2. 混入非法或已退役的预设（standard、tiktok-agent、重复 cordis、静态子代理）
    for (const illegal of ['standard', 'tiktok-agent', 'cordis', 'expert-image']) {
      mkdirSync(join(tmp, illegal))
      const resFail = checkPresetsHealth(tmp)
      equal(resFail.valid, false)
      ok(resFail.errors.some((e) => e.includes(`非法预设角色 [${illegal}]`)))
      rmSync(join(tmp, illegal), { recursive: true })
    }

    // 3. 缺少 Agent.md 或 skills.json 为空时必须报错
    rmSync(join(tmp, 'omni-agent', 'Agent.md'))
    const resMissingAgentMd = checkPresetsHealth(tmp)
    equal(resMissingAgentMd.valid, false)
    ok(resMissingAgentMd.errors.some((e) => e.includes('Agent.md')))

    // 4. 真实仓库 plugins/presets 目录必须通过校验
    const realRes = checkPresetsHealth(join(ROOT, 'presets'))
    equal(realRes.valid, true, realRes.errors.join('\n'))
    equal(realRes.presets.length, 1)
    equal(realRes.presets[0], 'omni-agent')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
